import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CareTeamMember,
  type ClinicalEntryMeta,
  clinicalError,
  CONSULT_ACCESS_HOURS,
  CONSULT_ANSWER_HOURS,
  type ConsultantOption,
  type ConsultantSearchQuery,
  type ConsultInboxItem,
  type ConsultRequestInput,
  type ConsultRequestRecord,
  type ConsultResponseInput,
  type ConsultResponseRecord,
  type ConsultUrgency,
  newId,
  type PrimaryDpjpChangeInput,
} from '@simrs/shared';
import { CareTeamService } from '../../infra/clinical/care-team.service';
import {
  assertRevisionAllowed,
  clinicalEncounter,
  lockClinicalKey,
} from '../../infra/clinical/clinical-context';
import { ClinicalRecordService, type ClinicalRowLike } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder } from '../../infra/clinical/staging';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { NotificationsService } from '../notifications/notifications.service';

const CURRENT = { supersededBy: { none: {} } } as const;
const HOUR = 3_600_000;
/** Sumber relasi akses konsultan (berbatas waktu, `CONSULT_ACCESS_HOURS`). */
export const CONSULT_ACCESS_SOURCE = 'consult_request';
/** Peran penugasan yang boleh mengirim konsul; yang menjawab hanya `dokter` (residen menyiapkan, bukan menjawab). */
const REQUESTER_ROLES = new Set(['dokter', 'dokter_residen']);
const CONSULTANT_ROLE = 'dokter';

type RequestRow = ClinicalRowLike & {
  patientId: string;
  encounterId: string;
  kind: string;
  urgency: string;
  toUserId: string | null;
  toUnitId: string | null;
  question: string;
};
type ResponseRow = ClinicalRowLike & {
  requestId: string;
  findings: string;
  assessment: string;
  recommendation: string;
  acceptComanagement: boolean;
};

/**
 * K10 · Konsultasi, rawat bersama, dan alih rawat (rencana fase 3 §3.8, ADR-0059):
 * - permintaan berversi oleh dokter/residen ke dokter tertentu dan/atau unit; dokter tujuan langsung mendapat relasi
 *   akses `konsultan` berbatas waktu (`CONSULT_ACCESS_HOURS`) dan notifikasi tanpa PHI;
 * - jawaban terstruktur HANYA oleh dokter tujuan (atau, bila tujuan hanya unit, dokter yang bertugas di unit itu),
 *   bukan pengirimnya; selain itu 403 `CONSULT_NOT_RECIPIENT`. Satu rantai jawaban per permintaan;
 * - konsul sekali yang dijawab: akses konsultan berakhir `CONSULT_ACCESS_HOURS` setelah jawaban;
 * - menerima rawat bersama → anggota tim `rawat_bersama`; menerima alih rawat → DPJP utama lama diakhiri dan penjawab
 *   menjadi DPJP utama (relasi akses ikut, `CareTeamService`); serah DPJP utama langsung lewat `changePrimary`;
 * - jawaban konsultasi = peristiwa biaya `konsultasi` sekali per rantai.
 */
@Injectable()
export class ConsultService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly matrix: PermissionMatrix,
    private readonly careTeam: CareTeamService,
    private readonly billable: BillableRecorder,
    private readonly notifications: NotificationsService,
  ) {}

  async createRequest(input: ConsultRequestInput): Promise<ConsultRequestRecord> {
    const me = this.records.author();
    if (!REQUESTER_ROLES.has(me.role)) {
      throw new AppError('FORBIDDEN', 'Konsul dikirim oleh dokter (DPJP/residen)', 403);
    }
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const tx = this.db.tx();
    if (input.toUserId) {
      if (input.toUserId === me.userId) {
        throw new AppError('VALIDATION_FAILED', 'Tidak bisa mengirim konsul ke diri sendiri', 422, {
          fields: ['toUserId'],
        });
      }
      if (!(await this.isActiveDoctor(input.toUserId))) {
        throw new AppError('VALIDATION_FAILED', 'Dokter tujuan tidak aktif atau bukan dokter', 422, {
          fields: ['toUserId'],
        });
      }
    }
    if (input.toUnitId) {
      const unit = await tx.unit.findUnique({ where: { id: input.toUnitId }, select: { id: true } });
      if (!unit) {
        throw new AppError('VALIDATION_FAILED', 'Unit tujuan tidak ditemukan', 422, { fields: ['toUnitId'] });
      }
    }
    const f = await this.records.prepare('consult_requests', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    await this.records.insert(() =>
      tx.consultRequest.create({
        data: {
          ...f,
          encounterId: enc.id,
          kind: input.kind,
          urgency: input.urgency,
          toUserId: input.toUserId,
          toUnitId: input.toUnitId,
          question: input.question,
        },
      }),
    );
    if (input.toUserId) {
      await this.grantConsultantAccess(input.toUserId, enc.patientId, f.rootId);
      if (!f.supersedesId && !f.addendumOf) {
        await this.notifications.notify([input.toUserId], {
          kind: 'consult_request',
          title: input.urgency === 'segera' ? 'Permintaan konsultasi SEGERA' : 'Permintaan konsultasi',
          body: 'Ada permintaan konsultasi untuk Anda. Buka kotak masuk konsultasi untuk rinciannya.',
          link: `/klinis/rawat-inap?kunjungan=${enc.id}`,
        });
      }
    }
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: 'consult_request',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { kind: input.kind, urgency: input.urgency, version: f.version },
    });
    return this.one(f.id);
  }

  async respond(requestId: string, input: ConsultResponseInput): Promise<ConsultRequestRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const req = await this.currentRequest(requestId);
    // Penerima ditetapkan SEBELUM pasien dibuka: hanya dokter tujuan (atau dokter unit tujuan), bukan pengirim.
    const myUnit = this.db.actor().unitId ?? null;
    const forMe = req.toUserId
      ? req.toUserId === me.userId
      : req.toUnitId !== null && req.toUnitId === myUnit;
    const root = await tx.consultRequest.findUniqueOrThrow({
      where: { id: req.rootId },
      select: { authorUserId: true },
    });
    if (!forMe || me.role !== CONSULTANT_ROLE || root.authorUserId === me.userId) {
      throw clinicalError('CONSULT_NOT_RECIPIENT');
    }
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    await lockClinicalKey(this.db, `consult:${req.rootId}`);
    const answered = await this.currentResponses(req.rootId);
    if (input.revision.kind === 'baru' && answered.length > 0) {
      throw new AppError(
        'CONFLICT',
        'Konsul ini sudah dijawab; koreksi atau tambahkan addendum jawaban',
        409,
      );
    }
    // Dokter unit tujuan: relasi konsultan berbatas waktu sebelum membuka pasien.
    await this.grantConsultantAccess(me.userId, req.patientId, req.rootId);
    const enc = await clinicalEncounter(this.db, this.access, req.encounterId, 'write');
    const f = await this.records.prepare('consult_responses', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    const accept = req.kind !== 'konsultasi' && input.accept;
    await this.records.insert(() =>
      tx.consultResponse.create({
        data: {
          ...f,
          encounterId: enc.id,
          requestId: req.id,
          findings: input.findings,
          assessment: input.assessment,
          recommendation: input.recommendation,
          acceptComanagement: accept,
        },
      }),
    );
    const first = !f.supersedesId && !f.addendumOf;
    if (first) {
      if (accept) await this.applyAcceptance(req, me.userId);
      else await this.limitConsultantAccess(req, new Date(Date.now() + CONSULT_ACCESS_HOURS * HOUR));
      await this.billable.record({
        encounterId: enc.id,
        patientId: enc.patientId,
        sourceType: 'consult_responses',
        sourceId: f.rootId,
        kind: 'konsultasi',
        occurredAt: f.occurredAt,
      });
      if (root.authorUserId !== me.userId) {
        await this.notifications.notify([root.authorUserId], {
          kind: 'consult_response',
          title: 'Jawaban konsultasi',
          body: 'Permintaan konsultasi Anda sudah dijawab. Buka tautan untuk membaca jawabannya.',
          link: `/klinis/rawat-inap?kunjungan=${enc.id}`,
        });
      }
    }
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: 'consult_response',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { requestId: req.id, kind: req.kind, accept, version: f.version },
    });
    return this.one(req.id);
  }

  async list(encounterId: string): Promise<ConsultRequestRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().consultRequest.findMany({
      where: { encounterId: enc.id, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    this.db.audit({
      action: 'read',
      resourceType: 'consult_request',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return this.present(rows);
  }

  /**
   * Pencarian dokter tujuan konsul / penerima DPJP utama (tanpa data pasien): pengguna aktif selain pelaku dengan
   * penugasan `dokter` yang berlaku, disaring nama dokter atau nama unit (`q`) dan/atau unit (`unitId`). Disaring dan
   * dibatasi di database per PENGGUNA (bukan per penugasan) dengan urutan stabil nama → id, jadi tidak ada dokter yang
   * hilang acak karena batas; daftar lengkap dicapai dengan mempersempit pencarian.
   */
  async consultants(query: ConsultantSearchQuery): Promise<ConsultantOption[]> {
    const me = this.records.author().userId;
    const now = new Date();
    const activeDoctor = {
      role: { code: CONSULTANT_ROLE },
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    };
    const q = query.q;
    const users = await this.db.tx().user.findMany({
      where: {
        id: { not: me },
        status: 'active',
        AND: [
          { assignments: { some: { ...activeDoctor, ...(query.unitId ? { unitId: query.unitId } : {}) } } },
          ...(q
            ? [
                {
                  OR: [
                    { displayName: { contains: q, mode: 'insensitive' as const } },
                    {
                      assignments: {
                        some: {
                          ...activeDoctor,
                          unit: { name: { contains: q, mode: 'insensitive' as const } },
                        },
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: query.limit,
      select: {
        id: true,
        displayName: true,
        assignments: {
          where: activeDoctor,
          orderBy: { unit: { name: 'asc' } },
          select: { unit: { select: { name: true } } },
        },
      },
    });
    return users.map((u) => ({
      userId: u.id,
      nama: u.displayName,
      units: [...new Set(u.assignments.flatMap((a) => (a.unit ? [a.unit.name] : [])))],
    }));
  }

  /** Permintaan terbuka untuk saya atau unit penugasan saya (tanpa jawaban final), kunjungan masih berjalan. */
  async inbox(): Promise<ConsultInboxItem[]> {
    const me = this.records.author().userId;
    const myUnit = this.db.actor().unitId ?? null;
    const tx = this.db.tx();
    const rows = await tx.consultRequest.findMany({
      where: {
        status: 'final',
        ...CURRENT,
        OR: [{ toUserId: me }, ...(myUnit ? [{ toUnitId: myUnit, toUserId: null }] : [])],
        encounter: { status: { notIn: ['finished', 'cancelled'] } },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        rootId: true,
        encounterId: true,
        patientId: true,
        kind: true,
        urgency: true,
        occurredAt: true,
        authorUserId: true,
        authorRole: true,
        toUnit: { select: { id: true, name: true } },
        patient: { select: { name: true, mrn: true } },
      },
    });
    const answeredRoots = await this.answeredRoots(rows.map((r) => r.rootId));
    const open = rows.filter((r) => !answeredRoots.has(r.rootId) && r.authorUserId !== me);
    const names = await this.records.userNames(open.map((r) => r.authorUserId));
    for (const pid of new Set(open.map((r) => r.patientId))) {
      this.db.audit({ action: 'read', resourceType: 'consult_inbox', patientId: pid });
    }
    return open.map((r) => ({
      requestId: r.id,
      encounterId: r.encounterId,
      patientId: r.patientId,
      patientName: r.patient.name,
      mrn: r.patient.mrn,
      kind: r.kind as ConsultInboxItem['kind'],
      urgency: r.urgency as ConsultInboxItem['urgency'],
      from: { userId: r.authorUserId, nama: names.get(r.authorUserId) ?? 'Pengguna', peran: r.authorRole },
      toUnit: r.toUnit,
      at: r.occurredAt.toISOString(),
      dueAt: dueAt(r.occurredAt, r.urgency).toISOString(),
    }));
  }

  /** Tim perawatan kunjungan (aktif + riwayat). */
  async careTeamOf(encounterId: string): Promise<CareTeamMember[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    this.db.audit({ action: 'read', resourceType: 'care_team', patientId: enc.patientId });
    return this.presentTeam(enc.id);
  }

  /**
   * Serah DPJP utama (versi baru tim perawatan): hanya DPJP utama aktif yang menyerahkan (atau dokter berakses bila
   * kunjungan belum punya DPJP utama). Keanggotaan lama diakhiri (relasi akses berlaku sampai akhir hari berikutnya),
   * dokter baru menjadi DPJP utama dengan relasi akses baru.
   */
  async changePrimary(encounterId: string, input: PrimaryDpjpChangeInput): Promise<CareTeamMember[]> {
    const me = this.records.author();
    if (me.role !== CONSULTANT_ROLE) {
      throw new AppError('FORBIDDEN', 'DPJP utama hanya diserahkan oleh dokter', 403);
    }
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    await lockClinicalKey(this.db, `care-team:${enc.id}`);
    const tx = this.db.tx();
    const current = await tx.encounterParticipant.findFirst({
      where: { encounterId: enc.id, role: 'dpjp_utama', endedAt: null },
      select: { id: true, userId: true },
    });
    if (current && current.userId !== me.userId) {
      throw new AppError('FORBIDDEN', 'Hanya DPJP utama aktif yang bisa menyerahkan DPJP utama', 403);
    }
    if (current?.userId === input.userId) {
      throw new AppError('VALIDATION_FAILED', 'Dokter ini sudah DPJP utama', 422, { fields: ['userId'] });
    }
    if (!(await this.isActiveDoctor(input.userId))) {
      throw new AppError('VALIDATION_FAILED', 'DPJP baru harus dokter aktif', 422, { fields: ['userId'] });
    }
    if (current) await this.careTeam.end(current.id, input.reason);
    await this.careTeam.add({ encounterId: enc.id, userId: input.userId, role: 'dpjp_utama' });
    this.db.audit({
      action: 'update',
      resourceType: 'care_team',
      resourceId: enc.id,
      patientId: enc.patientId,
      reason: input.reason,
      details: { role: 'dpjp_utama', from: current?.userId ?? null, to: input.userId },
    });
    return this.presentTeam(enc.id);
  }

  // ------------------------------------------------------------------------------------------------------------

  private async presentTeam(encounterId: string): Promise<CareTeamMember[]> {
    const rows = await this.db.tx().encounterParticipant.findMany({
      where: { encounterId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    const names = await this.records.userNames(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      user: { userId: r.userId, nama: names.get(r.userId) ?? 'Pengguna' },
      role: r.role as CareTeamMember['role'],
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      endReason: r.endReason,
    }));
  }

  /** Pengguna aktif dengan penugasan peran `dokter` yang masih berlaku. */
  private async isActiveDoctor(userId: string): Promise<boolean> {
    const now = new Date();
    const n = await this.db.tx().staffAssignment.count({
      where: {
        userId,
        user: { status: 'active' },
        role: { code: CONSULTANT_ROLE },
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
    });
    return n > 0;
  }

  /** Versi final terkini rantai permintaan (id versi mana pun boleh dikirim klien). */
  private async currentRequest(id: string): Promise<RequestRow> {
    const tx = this.db.tx();
    const any = await tx.consultRequest.findUnique({ where: { id }, select: { rootId: true } });
    if (!any) throw new AppError('NOT_FOUND', 'Permintaan konsultasi tidak ditemukan', 404);
    const row = await tx.consultRequest.findFirst({ where: { rootId: any.rootId, ...CURRENT } });
    if (!row || row.status !== 'final') {
      throw new AppError('CONFLICT', 'Permintaan konsultasi ini sudah ditandai salah entri', 409);
    }
    return row;
  }

  /** Jawaban final terkini untuk rantai permintaan (semua versi permintaan). */
  private async currentResponses(rootId: string): Promise<ResponseRow[]> {
    const tx = this.db.tx();
    const chain = await tx.consultRequest.findMany({ where: { rootId }, select: { id: true } });
    return tx.consultResponse.findMany({
      where: { requestId: { in: chain.map((c) => c.id) }, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async answeredRoots(rootIds: string[]): Promise<Set<string | undefined>> {
    if (rootIds.length === 0) return new Set();
    const tx = this.db.tx();
    const chain = await tx.consultRequest.findMany({
      where: { rootId: { in: rootIds } },
      select: { id: true, rootId: true },
    });
    const answered = await tx.consultResponse.findMany({
      where: { requestId: { in: chain.map((c) => c.id) }, status: 'final', ...CURRENT },
      select: { requestId: true },
    });
    const rootOf = new Map(chain.map((c) => [c.id, c.rootId]));
    return new Set(answered.map((a) => rootOf.get(a.requestId)));
  }

  /** Relasi akses `konsultan` berbatas waktu (tidak dibuat ganda selama masih berlaku). */
  private async grantConsultantAccess(
    userId: string,
    patientId: string,
    requestRootId: string,
  ): Promise<void> {
    const tx = this.db.tx();
    const now = new Date();
    const existing = await tx.accessRelationship.findFirst({
      where: {
        userId,
        patientId,
        sourceType: CONSULT_ACCESS_SOURCE,
        sourceId: requestRootId,
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { id: true },
    });
    if (existing) return;
    await tx.accessRelationship.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        userId,
        patientId,
        kind: 'konsultan',
        validFrom: now,
        validUntil: new Date(now.getTime() + CONSULT_ACCESS_HOURS * HOUR),
        sourceType: CONSULT_ACCESS_SOURCE,
        sourceId: requestRootId,
      },
    });
  }

  /** Konsul sekali dijawab: akses konsultan berakhir `until` (dipendekkan atau diperpanjang ke batas itu). */
  private async limitConsultantAccess(req: RequestRow, until: Date): Promise<void> {
    await this.db.tx().accessRelationship.updateMany({
      where: {
        patientId: req.patientId,
        sourceType: CONSULT_ACCESS_SOURCE,
        sourceId: req.rootId,
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      data: { validUntil: until },
    });
  }

  /** Terima rawat bersama / alih rawat: tim perawatan (dan relasi akses) ikut berubah. */
  private async applyAcceptance(req: RequestRow, me: string): Promise<void> {
    await lockClinicalKey(this.db, `care-team:${req.encounterId}`);
    const tx = this.db.tx();
    const active = await tx.encounterParticipant.findMany({
      where: { encounterId: req.encounterId, endedAt: null },
      select: { id: true, userId: true, role: true },
    });
    if (req.kind === 'rawat_bersama') {
      if (!active.some((p) => p.userId === me && p.role === 'rawat_bersama')) {
        await this.careTeam.add({ encounterId: req.encounterId, userId: me, role: 'rawat_bersama' });
      }
      return;
    }
    // Alih rawat: DPJP utama lama diakhiri, penjawab menjadi DPJP utama (satu DPJP utama aktif).
    for (const p of active.filter((x) => x.role === 'dpjp_utama' && x.userId !== me)) {
      await this.careTeam.end(p.id, 'Alih rawat lewat konsultasi');
    }
    if (!active.some((p) => p.userId === me && p.role === 'dpjp_utama')) {
      await this.careTeam.add({ encounterId: req.encounterId, userId: me, role: 'dpjp_utama' });
    }
  }

  private async one(id: string): Promise<ConsultRequestRecord> {
    const tx = this.db.tx();
    const any = await tx.consultRequest.findUniqueOrThrow({ where: { id }, select: { rootId: true } });
    const row = await tx.consultRequest.findFirstOrThrow({ where: { rootId: any.rootId, ...CURRENT } });
    return (await this.present([row]))[0] as ConsultRequestRecord;
  }

  private async present(rows: RequestRow[]): Promise<ConsultRequestRecord[]> {
    if (rows.length === 0) return [];
    const tx = this.db.tx();
    const chain = await tx.consultRequest.findMany({
      where: { rootId: { in: rows.map((r) => r.rootId) } },
      select: { id: true, rootId: true },
    });
    const rootOf = new Map(chain.map((c) => [c.id, c.rootId]));
    const responses: ResponseRow[] = await tx.consultResponse.findMany({
      where: { requestId: { in: [...rootOf.keys()] }, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const [meta, respMeta, units, names] = await Promise.all([
      this.records.meta('consult_requests', rows),
      this.records.meta('consult_responses', responses),
      tx.unit.findMany({
        where: { id: { in: rows.flatMap((r) => (r.toUnitId ? [r.toUnitId] : [])) } },
        select: { id: true, name: true },
      }),
      this.records.userNames(rows.flatMap((r) => (r.toUserId ? [r.toUserId] : []))),
    ]);
    return rows.map((r) => {
      const mine = responses.filter((x) => rootOf.get(x.requestId) === r.rootId);
      return {
        ...(meta.get(r.id) as ClinicalEntryMeta),
        patientId: r.patientId,
        encounterId: r.encounterId,
        kind: r.kind as ConsultRequestRecord['kind'],
        urgency: r.urgency as ConsultRequestRecord['urgency'],
        toUser: r.toUserId ? { userId: r.toUserId, nama: names.get(r.toUserId) ?? 'Pengguna' } : null,
        toUnit: units.find((u) => u.id === r.toUnitId) ?? null,
        question: r.question,
        dueAt: dueAt(r.occurredAt, r.urgency).toISOString(),
        state: mine.length > 0 ? 'dijawab' : 'menunggu',
        responses: mine.map((x): ConsultResponseRecord => ({
          ...(respMeta.get(x.id) as ClinicalEntryMeta),
          requestId: x.requestId,
          findings: x.findings,
          assessment: x.assessment,
          recommendation: x.recommendation,
          accept: x.acceptComanagement,
          followUp: x.acceptComanagement ? (r.kind as 'rawat_bersama' | 'alih_rawat') : 'selesai',
        })),
      };
    });
  }
}

function dueAt(occurredAt: Date, urgency: string): Date {
  return new Date(occurredAt.getTime() + CONSULT_ANSWER_HOURS[urgency as ConsultUrgency] * HOUR);
}
