import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CareTeamMember,
  type ClinicalEntryMeta,
  CONSULT_ACCESS_HOURS,
  type ConsultInboxItem,
  type ConsultRequestInput,
  type ConsultRequestRecord,
  type ConsultResponseInput,
  type ConsultResponseRecord,
  newId,
} from '@simrs/shared';
import { CareTeamService } from '../../infra/clinical/care-team.service';
import { assertRevisionAllowed, clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService, type ClinicalRowLike } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder } from '../../infra/clinical/staging';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { NotificationsService } from '../notifications/notifications.service';

const CURRENT = { supersededBy: { none: {} } } as const;
/** Sumber relasi akses konsultan (berbatas waktu, `CONSULT_ACCESS_HOURS`). */
export const CONSULT_ACCESS_SOURCE = 'consult_request';

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
 * K10 · Konsultasi, rawat bersama, dan alih rawat (rencana fase 3 §3.8):
 * - permintaan berversi ke dokter tertentu dan/atau unit; dokter tujuan langsung mendapat relasi akses `konsultan`
 *   berbatas waktu (`CONSULT_ACCESS_HOURS`) dan notifikasi tanpa PHI;
 * - jawaban terstruktur oleh dokter tujuan, atau dokter yang bertugas di unit tujuan (yang saat itu mendapat relasi
 *   konsultan berbatas waktu yang sama);
 * - menerima rawat bersama → anggota tim `rawat_bersama`; menerima alih rawat → DPJP utama lama diakhiri dan
 *   penjawab menjadi DPJP utama (relasi akses ikut, `CareTeamService`);
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
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const tx = this.db.tx();
    const me = this.records.author().userId;
    if (input.toUserId) {
      if (input.toUserId === me) throw new AppError('VALIDATION_FAILED', 'Konsultasi bukan ke diri sendiri', 422);
      const u = await tx.user.findUnique({ where: { id: input.toUserId }, select: { status: true } });
      if (u?.status !== 'active') throw new AppError('VALIDATION_FAILED', 'Dokter tujuan tidak aktif', 422);
    }
    if (input.toUnitId) {
      const unit = await tx.unit.findUnique({ where: { id: input.toUnitId }, select: { id: true } });
      if (!unit) throw new AppError('VALIDATION_FAILED', 'Unit tujuan tidak ditemukan', 422);
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
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const tx = this.db.tx();
    const me = this.records.author().userId;
    const req = await this.currentRequest(requestId);
    const myUnit = this.db.actor().unitId ?? null;
    const forMe = req.toUserId === me || (req.toUnitId !== null && req.toUnitId === myUnit);
    if (!forMe) {
      throw new AppError('FORBIDDEN', 'Konsultasi ini bukan untuk Anda atau unit penugasan Anda', 403);
    }
    // Dokter unit tujuan: relasi konsultan berbatas waktu sebelum membuka pasien.
    await this.grantConsultantAccess(me, req.patientId, req.rootId);
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
    if (accept && !f.supersedesId && !f.addendumOf) await this.applyAcceptance(req, me);
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'consult_responses',
      sourceId: f.rootId,
      kind: 'konsultasi',
      occurredAt: f.occurredAt,
    });
    if (req.authorUserId !== me && !f.supersedesId) {
      await this.notifications.notify([req.authorUserId], {
        kind: 'consult_response',
        title: 'Jawaban konsultasi',
        body: 'Permintaan konsultasi Anda sudah dijawab. Buka tautan untuk membaca jawabannya.',
        link: `/klinis/rawat-inap?kunjungan=${enc.id}`,
      });
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

  /** Permintaan terbuka untuk saya atau unit penugasan saya (tanpa jawaban final). */
  async inbox(): Promise<ConsultInboxItem[]> {
    const me = this.records.author().userId;
    const myUnit = this.db.actor().unitId ?? null;
    const tx = this.db.tx();
    const rows = await tx.consultRequest.findMany({
      where: {
        status: 'final',
        ...CURRENT,
        OR: [{ toUserId: me }, ...(myUnit ? [{ toUnitId: myUnit }] : [])],
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
    const chain = await tx.consultRequest.findMany({
      where: { rootId: { in: rows.map((r) => r.rootId) } },
      select: { id: true, rootId: true },
    });
    const answered = await tx.consultResponse.findMany({
      where: { requestId: { in: chain.map((c) => c.id) }, status: 'final', ...CURRENT },
      select: { requestId: true },
    });
    const rootOf = new Map(chain.map((c) => [c.id, c.rootId]));
    const answeredRoots = new Set(answered.map((a) => rootOf.get(a.requestId)));
    const open = rows.filter((r) => !answeredRoots.has(r.rootId));
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
    }));
  }

  /** Tim perawatan kunjungan (aktif + riwayat). */
  async careTeam(encounterId: string): Promise<CareTeamMember[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().encounterParticipant.findMany({
      where: { encounterId: enc.id },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    const names = await this.records.userNames(rows.map((r) => r.userId));
    this.db.audit({ action: 'read', resourceType: 'care_team', patientId: enc.patientId });
    return rows.map((r) => ({
      id: r.id,
      user: { userId: r.userId, nama: names.get(r.userId) ?? 'Pengguna' },
      role: r.role as CareTeamMember['role'],
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      endReason: r.endReason,
    }));
  }

  // ------------------------------------------------------------------------------------------------------------

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

  /** Relasi akses `konsultan` berbatas waktu (tidak dibuat ganda selama masih berlaku). */
  private async grantConsultantAccess(userId: string, patientId: string, requestRootId: string): Promise<void> {
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
        validUntil: new Date(now.getTime() + CONSULT_ACCESS_HOURS * 3_600_000),
        sourceType: CONSULT_ACCESS_SOURCE,
        sourceId: requestRootId,
      },
    });
  }

  /** Terima rawat bersama / alih rawat: tim perawatan (dan relasi akses) ikut berubah. */
  private async applyAcceptance(req: RequestRow, me: string): Promise<void> {
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
        state: mine.length > 0 ? 'dijawab' : 'menunggu',
        responses: mine.map(
          (x): ConsultResponseRecord => ({
            ...(respMeta.get(x.id) as ClinicalEntryMeta),
            requestId: x.requestId,
            findings: x.findings,
            assessment: x.assessment,
            recommendation: x.recommendation,
            accept: x.acceptComanagement,
          }),
        ),
      };
    });
  }
}
