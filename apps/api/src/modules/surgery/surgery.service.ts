import { Injectable } from '@nestjs/common';
import { allocateNumber, getConcept, readTenantSetting } from '@simrs/db';
import {
  AppError,
  CHECKLIST_PHASES,
  type ChecklistPhaseId,
  CONSENT_CHECKLIST_ITEM,
  COUNT_ITEM,
  formatTanggalWaktu,
  newId,
  occurredInFuture,
  type OperativeReportCreateInput,
  operativeReportCreateSchema,
  type SurgeryCaseInput,
  type SurgeryCaseView,
  type SurgeryEventInput,
  type SurgerySpecimenInput,
  type SurgicalCountInput,
  supportError,
  surgerySpecimenInputSchema,
  unreconciledCountItems,
} from '@simrs/shared';
import { DEV_ROLE } from '../../common/request-context';
import { CareTeamService } from '../../infra/clinical/care-team.service';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../../infra/clinical/clinical-signing.service';
import { DomainEvents } from '../../infra/events/domain-events';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { type CaseRow, mapSurgeryDb, SurgeryAccess } from './surgery-access';
import { SurgeryBoardService } from './surgery-board.service';

const ACTIVE_ENCOUNTER = ['planned', 'arrived', 'in_progress'];
/** Peran tim operasi yang dokter (masuk tim perawatan kunjungan sebagai rawat bersama). */
const DOCTOR_TEAM_ROLES: ReadonlySet<string> = new Set(['operator', 'asisten', 'anestesi']);
const REPORT_TITLE = {
  baru: 'Laporan operasi',
  koreksi: 'Koreksi laporan operasi',
  addendum: 'Adendum laporan operasi',
} as const;
/** Peran tim yang boleh meng-override insisi sebelum time out (ADR-0130). */
const OVERRIDE_TEAM_ROLES = ['operator', 'anestesi'] as const;

/**
 * S06 · Kamar operasi (rencana fase 4 §4.7, keputusan no. 13–14): jadwal kamar (EXCLUDE → 409 `ROOM_OVERLAP`), tim,
 * batal beralasan, daftar tilik WHO berurutan (butir persetujuan diisi sistem dari persetujuan tindakan 3.7; time out
 * memeriksa ulang persetujuan; butir hitung diisi sistem dari rekonsiliasi), peristiwa intraoperatif (insisi sebelum
 * time out hanya override dokter beralasan → notifikasi mutu), hitung kasa + tindak lanjut selisih, BHP dari depo OK,
 * laporan operasi berversi ber-TTE operator. Urutan dan kelengkapan juga dijaga trigger database 4.0b.
 */
@Injectable()
export class SurgeryService {
  constructor(
    private readonly db: TenantDb,
    private readonly scope: SurgeryAccess,
    private readonly board: SurgeryBoardService,
    private readonly events: DomainEvents,
    private readonly matrix: PermissionMatrix,
    private readonly notifications: NotificationsService,
    private readonly records: ClinicalRecordService,
    private readonly signing: ClinicalSigningService,
    private readonly careTeam: CareTeamService,
  ) {}

  // ───────────────────────────── Jadwal ─────────────────────────────

  async schedule(input: SurgeryCaseInput): Promise<SurgeryCaseView> {
    await this.scope.assertUnit();
    const tx = this.db.tx();
    const me = this.me();
    const enc = await tx.encounter.findUnique({
      where: { id: input.encounterId },
      select: { id: true, patientId: true, status: true, unitId: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    if (!ACTIVE_ENCOUNTER.includes(enc.status)) {
      throw new AppError('CONFLICT', 'Operasi hanya untuk kunjungan yang masih aktif', 409);
    }
    const room = await tx.location.findUnique({
      where: { id: input.roomId },
      select: { id: true, kind: true, active: true, unitId: true },
    });
    if (!room || !room.active || room.kind !== 'ruang' || room.unitId !== (await this.scope.okUnitId())) {
      throw new AppError('VALIDATION_FAILED', 'Kamar bukan kamar operasi yang aktif', 422);
    }
    const userIds = [...new Set(input.team.map((t) => t.userId))];
    const users = await tx.user.findMany({
      where: { id: { in: userIds }, status: 'active' },
      select: { id: true },
    });
    if (users.length !== userIds.length) {
      throw new AppError('VALIDATION_FAILED', 'Anggota tim tidak dikenal atau tidak aktif', 422);
    }
    if (!input.team.some((t) => t.role === 'operator')) {
      throw new AppError('VALIDATION_FAILED', 'Tim operasi wajib punya operator', 422);
    }
    if (input.procedureCode && !(await getConcept(tx, 'icd9cm', input.procedureCode))?.active) {
      throw new AppError('VALIDATION_FAILED', 'Kode tindakan harus ICD-9-CM dari data rujukan', 422);
    }
    const template = await tx.surgeryChecklistTemplate.findFirst({
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!template) throw new AppError('CONFLICT', 'Templat daftar tilik WHO belum diterbitkan', 409);
    const consent = (await this.board.activeConsents([enc.id])).get(enc.id) ?? null;
    const id = newId();
    const caseNo = (await allocateNumber(tx, this.db.tenantId(), 'surgery_case')).number;
    await mapSurgeryDb(() =>
      tx.surgeryCase.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          caseNo,
          encounterId: enc.id,
          patientId: enc.patientId,
          roomId: room.id,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          priority: input.priority,
          procedureName: input.procedureName,
          procedureCode: input.procedureCode,
          consentId: consent?.id ?? null,
          checklistTemplateId: template.id,
          createdBy: me,
        },
      }),
    );
    await this.history(id, null, 'terjadwal', null);
    for (const t of input.team) {
      await tx.surgeryCaseTeam.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          surgeryCaseId: id,
          userId: t.userId,
          role: t.role,
        },
      });
    }
    // Dokter tim (operator, asisten, anestesi) = rawat bersama kunjungan (ADR-0031): relasi resmi untuk laporan operasi
    // ber-TTE dan catatan anestesi tanpa akses darurat. Perawat OK memakai lingkup unit.
    for (const userId of new Set(
      input.team.filter((t) => DOCTOR_TEAM_ROLES.has(t.role)).map((t) => t.userId),
    )) {
      const member = await tx.encounterParticipant.findFirst({
        where: { encounterId: enc.id, userId, endedAt: null },
        select: { id: true },
      });
      if (!member) await this.careTeam.add({ encounterId: enc.id, userId, role: 'rawat_bersama' });
    }
    await this.events.publish('surgery.case_scheduled', {
      surgeryCaseId: id,
      encounterId: enc.id,
      patientId: enc.patientId,
      unitId: enc.unitId,
      roomId: room.id,
      priority: input.priority,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'surgery_case',
      resourceId: id,
      patientId: enc.patientId,
      details: { caseNo, roomId: room.id, priority: input.priority },
    });
    return this.board.one(id);
  }

  async cancel(caseId: string, reason: string): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId);
    if (c.status === 'berjalan' || c.status === 'selesai' || c.status === 'batal') {
      throw new AppError('CONFLICT', `Kasus berstatus ${c.status} tidak bisa dibatalkan`, 409);
    }
    const tx = this.db.tx();
    await tx.surgeryCase.update({ where: { id: c.id }, data: { status: 'batal', cancelReason: reason } });
    await this.releaseTeam(c);
    await this.history(c.id, c.status, 'batal', reason);
    const enc = await this.encounterOf(c);
    await this.events.publish('surgery.case_cancelled', {
      surgeryCaseId: c.id,
      encounterId: c.encounterId,
      patientId: c.patientId,
      unitId: enc.unitId,
      roomId: c.roomId,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'surgery_case',
      resourceId: c.id,
      patientId: c.patientId,
      reason,
      details: { status: 'batal' },
    });
    return this.board.one(c.id);
  }

  // ───────────────────────────── Daftar tilik WHO ─────────────────────────────

  /** Centang butir manual fase aktif. Butir sistem (persetujuan, hitung) ditolak trigger → 409. */
  async checkItem(caseId: string, phase: ChecklistPhaseId, itemCode: string): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId, true);
    await mapSurgeryDb(() =>
      this.db.tx().surgicalSafetyCheck.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          surgeryCaseId: c.id,
          phase,
          itemCode,
          source: 'manual',
          checkedBy: this.me(),
        },
      }),
    );
    this.db.audit({
      action: 'update',
      resourceType: 'surgical_checklist',
      resourceId: c.id,
      patientId: c.patientId,
      details: { phase, item: itemCode },
    });
    return this.board.one(c.id);
  }

  /**
   * Konfirmasi fase. Sign in: butir persetujuan diisi sistem bila persetujuan tindakan 3.7 berlaku (tanpanya 409).
   * Time out: persetujuan diperiksa ULANG (dicabut sesudah sign in → 409). Sign out: butir hitung diisi sistem bila
   * semua hitung cocok/ditindaklanjuti. Urutan, kelengkapan, dan sign out (insisi + hitung) dijaga trigger.
   */
  async confirm(caseId: string, phase: ChecklistPhaseId): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId, true);
    const tx = this.db.tx();
    const confirmed = (
      await tx.surgicalSafetyConfirmation.findMany({
        where: { surgeryCaseId: c.id },
        select: { phase: true },
      })
    ).map((x) => x.phase as ChecklistPhaseId);
    if (confirmed.includes(phase))
      throw supportError('CHECKLIST_ORDER', undefined, 'Fase ini sudah dikonfirmasi');
    const expected = CHECKLIST_PHASES.find((p) => !confirmed.includes(p));
    if (expected !== phase) throw supportError('CHECKLIST_ORDER');
    if (phase === 'sign-in' || phase === 'time-out') {
      const consent = (await this.board.activeConsents([c.encounterId])).get(c.encounterId);
      if (!consent) {
        throw supportError(
          'CHECKLIST_INCOMPLETE',
          { consent: false },
          phase === 'sign-in'
            ? 'Persetujuan tindakan bertanda tangan belum ada; sign in tertahan'
            : 'Persetujuan tindakan tidak berlaku lagi (dicabut); time out tertahan',
        );
      }
      if (phase === 'sign-in') {
        // 4.7b: sign in juga menuntut asesmen pra-anestesi final (formulir P07) untuk kunjungan kasus.
        const pre = (await this.board.anesthesiaForms([c.encounterId])).get(c.encounterId)?.pre;
        if (!pre) {
          throw supportError(
            'CHECKLIST_INCOMPLETE',
            { preAnesthesia: false },
            'Asesmen pra-anestesi final belum ada; sign in tertahan',
          );
        }
        await this.systemCheck(c.id, 'sign-in', CONSENT_CHECKLIST_ITEM);
        await tx.surgeryCase.update({ where: { id: c.id }, data: { consentId: consent.id } });
      }
    }
    if (phase === 'sign-out') {
      const counts = await tx.surgicalCount.findMany({
        where: { surgeryCaseId: c.id },
        select: { itemCode: true, kind: true, quantity: true },
      });
      const resolved = (
        await tx.surgeryCountDiscrepancy.findMany({
          where: { surgeryCaseId: c.id },
          select: { itemCode: true },
        })
      ).map((d) => d.itemCode);
      const open = unreconciledCountItems(
        counts.map((x) => ({ ...x, kind: x.kind as 'awal' | 'tambahan' | 'akhir' })),
        resolved,
      );
      if (counts.length === 0 || open.length > 0) throw supportError('COUNT_MISMATCH', { items: open });
      await this.systemCheck(c.id, 'sign-out', COUNT_ITEM);
    }
    await mapSurgeryDb(() =>
      tx.surgicalSafetyConfirmation.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          surgeryCaseId: c.id,
          phase,
          confirmedBy: this.me(),
        },
      }),
    );
    if (phase === 'sign-in' && c.status === 'terjadwal') {
      await tx.surgeryCase.update({ where: { id: c.id }, data: { status: 'persiapan' } });
      await this.history(c.id, c.status, 'persiapan', null);
    }
    this.db.audit({
      action: 'update',
      resourceType: 'surgical_checklist',
      resourceId: c.id,
      patientId: c.patientId,
      details: { confirmed: phase },
    });
    return this.board.one(c.id);
  }

  // ───────────────────────────── Peristiwa ─────────────────────────────

  async recordEvent(caseId: string, input: SurgeryEventInput): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId, true);
    const tx = this.db.tx();
    const occurredAt = new Date(input.occurredAt);
    if (occurredInFuture(occurredAt, new Date())) {
      throw new AppError('VALIDATION_FAILED', 'Waktu peristiwa tidak boleh di masa depan', 422);
    }
    const confirmed = (
      await tx.surgicalSafetyConfirmation.findMany({
        where: { surgeryCaseId: c.id },
        select: { phase: true },
      })
    ).map((x) => x.phase);
    const override = input.kind === 'insisi' && !confirmed.includes('time-out') ? input.overrideReason : null;
    if (input.overrideReason && !override) {
      throw new AppError('VALIDATION_FAILED', 'Alasan override hanya untuk insisi sebelum time out', 422);
    }
    if (override) {
      // Insisi tanpa time out = tanggung jawab operator atau dokter anestesi kasus ini (anggota tim aktif) yang
      // memegang `surgery.override`; dokter lain yang sekadar berelasi dengan pasien (DPJP bangsal, asisten) ditolak.
      const me = this.db.actorUserId();
      const accountable = me
        ? await tx.surgeryCaseTeam.findFirst({
            where: { surgeryCaseId: c.id, userId: me, role: { in: [...OVERRIDE_TEAM_ROLES] }, endedAt: null },
            select: { id: true },
          })
        : null;
      if (!accountable || !(await this.holds('surgery', 'override'))) {
        throw new AppError(
          'FORBIDDEN',
          'Override insisi sebelum time out hanya oleh operator atau dokter anestesi kasus ini',
          403,
        );
      }
      const min = await readTenantSetting(tx, 'surgery.override_reason_min');
      if (override.trim().length < min) {
        throw new AppError('VALIDATION_FAILED', `Alasan override minimal ${min} karakter`, 422);
      }
    }
    if (input.kind === 'keluar' && !confirmed.includes('sign-out')) {
      throw supportError('CHECKLIST_ORDER', undefined, 'Pasien keluar kamar setelah sign out dikonfirmasi');
    }
    const eventId = newId();
    await mapSurgeryDb(() =>
      tx.surgeryEvent.create({
        data: {
          id: eventId,
          tenantId: this.db.tenantId(),
          surgeryCaseId: c.id,
          kind: input.kind,
          occurredAt,
          overrideReason: override,
          recordedBy: this.me(),
        },
      }),
    );
    const enc = await this.encounterOf(c);
    const base = {
      surgeryCaseId: c.id,
      encounterId: c.encounterId,
      patientId: c.patientId,
      unitId: enc.unitId,
    };
    if (input.kind === 'induksi' && c.status !== 'berjalan') {
      await tx.surgeryCase.update({ where: { id: c.id }, data: { status: 'berjalan' } });
      await this.history(c.id, c.status, 'berjalan', null);
    }
    if (input.kind === 'insisi') {
      await this.events.publish('surgery.incision_recorded', { ...base, override: !!override });
      if (override) await this.notifyQuality(c);
    }
    if (input.kind === 'keluar') {
      const first = await tx.surgeryEvent.findFirst({
        where: { surgeryCaseId: c.id },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      });
      const usages = await tx.surgerySupplyUsage.findMany({
        where: { surgeryCaseId: c.id },
        select: { id: true },
      });
      await tx.surgeryCase.update({ where: { id: c.id }, data: { status: 'selesai' } });
      await this.history(c.id, c.status, 'selesai', null);
      await this.events.publish('surgery.case_completed', {
        ...base,
        roomId: c.roomId,
        durationMinutes: Math.max(
          0,
          Math.round((occurredAt.getTime() - (first?.occurredAt ?? occurredAt).getTime()) / 60_000),
        ),
        supplyUsageIds: usages.map((u) => u.id),
      });
    }
    this.db.audit({
      action: 'create',
      resourceType: 'surgery_event',
      resourceId: eventId,
      patientId: c.patientId,
      reason: override,
      details: { kind: input.kind, override: !!override, review: !!override },
    });
    return this.board.one(c.id);
  }

  /** Override insisi: komite mutu (auditor mutu + manajemen) diberi tahu, tanpa PHI di isi notifikasi. */
  private async notifyQuality(c: CaseRow): Promise<void> {
    const at = new Date();
    const reviewers = await this.db.tx().staffAssignment.findMany({
      where: {
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        role: { code: { in: ['auditor_mutu', 'manajemen'] }, active: true },
        user: { status: 'active' },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    await this.notifications.notify(
      reviewers.map((r) => r.userId),
      {
        kind: 'surgery_override',
        title: 'Insisi sebelum time out (override)',
        body: 'Dokter mencatat insisi sebelum time out dikonfirmasi dengan alasan tertulis. Tinjau di jejak audit.',
        link: `/sistem/audit?pasien=${c.patientId}`,
      },
      ['in_app', 'email'],
    );
  }

  // ───────────────────────────── Hitung kasa ─────────────────────────────

  async count(caseId: string, input: SurgicalCountInput): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId, true);
    const confirmed = await this.db.tx().surgicalSafetyConfirmation.findFirst({
      where: { surgeryCaseId: c.id, phase: 'sign-out' },
      select: { id: true },
    });
    if (confirmed) throw new AppError('CONFLICT', 'Sign out sudah dikonfirmasi; hitung terkunci', 409);
    for (const item of input.items) {
      await this.db.tx().surgicalCount.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          surgeryCaseId: c.id,
          kind: input.kind,
          itemCode: item.itemCode,
          label: item.label,
          quantity: item.quantity,
          countedBy: this.me(),
        },
      });
    }
    this.db.audit({
      action: 'create',
      resourceType: 'surgical_count',
      resourceId: c.id,
      patientId: c.patientId,
      details: { kind: input.kind, items: input.items.length },
    });
    return this.board.one(c.id);
  }

  async discrepancy(caseId: string, itemCode: string, action: string): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId, true);
    const exists = await this.db.tx().surgicalCount.findFirst({
      where: { surgeryCaseId: c.id, itemCode },
      select: { id: true },
    });
    if (!exists) throw new AppError('NOT_FOUND', 'Butir hitung tidak ditemukan', 404);
    await this.db.tx().surgeryCountDiscrepancy.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        surgeryCaseId: c.id,
        itemCode,
        action,
        recordedBy: this.me(),
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'surgical_count_discrepancy',
      resourceId: c.id,
      patientId: c.patientId,
      reason: action,
      details: { item: itemCode },
    });
    return this.board.one(c.id);
  }

  // ───────────────────────────── BHP / implan ─────────────────────────────

  async supplyOptions() {
    await this.scope.assertUnit();
    const depot = await this.okDepot();
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const rows = await this.db.tx().stockBalance.findMany({
      where: { stockLocationId: depot, quantity: { gt: 0 }, stockBatch: { expiryDate: { gt: today } } },
      include: {
        stockBatch: { select: { batchNo: true, expiryDate: true, drug: { select: { name: true } } } },
      },
      orderBy: [{ stockBatch: { expiryDate: 'asc' } }],
    });
    return {
      items: rows.map((r) => ({
        stockBatchId: r.stockBatchId,
        name: r.stockBatch.drug.name,
        batchNo: r.stockBatch.batchNo,
        expiryDate: r.stockBatch.expiryDate.toISOString().slice(0, 10),
        quantity: r.quantity,
      })),
    };
  }

  /** BHP/implan terpakai → ledger `usage` depo OK (saldo + batch kedaluwarsa dijaga trigger ledger). */
  async supplies(
    caseId: string,
    items: Array<{ stockBatchId: string; quantity: number; implant: boolean }>,
  ): Promise<SurgeryCaseView> {
    const c = await this.lockCase(caseId, true);
    const depot = await this.okDepot();
    const tx = this.db.tx();
    for (const item of items) {
      const movementId = newId();
      await mapSurgeryDb(() =>
        tx.stockMovement.create({
          data: {
            id: movementId,
            tenantId: this.db.tenantId(),
            stockLocationId: depot,
            stockBatchId: item.stockBatchId,
            kind: 'usage',
            quantity: -item.quantity,
            refType: 'surgery_cases',
            refId: c.id,
            encounterId: c.encounterId,
            patientId: c.patientId,
            createdBy: this.me(),
          },
        }),
      );
      await tx.surgerySupplyUsage.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          surgeryCaseId: c.id,
          stockMovementId: movementId,
          implant: item.implant,
          recordedBy: this.me(),
        },
      });
    }
    this.db.audit({
      action: 'create',
      resourceType: 'surgery_supply',
      resourceId: c.id,
      patientId: c.patientId,
      details: { items: items.length },
    });
    return this.board.one(c.id);
  }

  // ───────────────────────────── Laporan operasi ─────────────────────────────

  /**
   * Laporan operasi (entri berversi ADR-0028) oleh OPERATOR kasus, setelah insisi; PDF + TTE operator lewat
   * `ClinicalSigningService.issueSigned` (versi bertanda tangan terkunci, perubahan lewat koreksi bila TTE gagal).
   * Diagnosa ICD-10 dan tindakan ICD-9-CM wajib dari data rujukan.
   */
  async report(caseId: string, raw: OperativeReportCreateInput): Promise<SurgeryCaseView> {
    const input = operativeReportCreateSchema.parse(raw);
    const c = await this.scope.loadCase(caseId);
    if (c.status === 'batal') throw new AppError('CONFLICT', 'Kasus operasi sudah batal', 409);
    const tx = this.db.tx();
    const me = this.me();
    const operator = await tx.surgeryCaseTeam.findFirst({
      where: { surgeryCaseId: c.id, userId: me, role: 'operator', endedAt: null },
      select: { id: true },
    });
    if (!operator)
      throw new AppError('FORBIDDEN', 'Laporan operasi ditulis dan ditandatangani operator', 403);
    if (input.revision.kind !== 'baru') {
      // Koreksi/adendum hanya atas laporan kasus ini (rantai lain di kunjungan yang sama ditolak).
      const targetId =
        input.revision.kind === 'koreksi' ? input.revision.supersedesId : input.revision.addendumOf;
      const target = await tx.operativeReport.findFirst({
        where: { id: targetId, surgeryCaseId: c.id },
        select: { id: true },
      });
      if (!target) throw new AppError('NOT_FOUND', 'Laporan operasi tidak ditemukan pada kasus ini', 404);
    }
    const incision = await tx.surgeryEvent.findFirst({
      where: { surgeryCaseId: c.id, kind: 'insisi' },
      select: { id: true },
    });
    if (!incision)
      throw supportError('CHECKLIST_ORDER', undefined, 'Laporan operasi setelah insisi tercatat');
    for (const dx of [input.preOpDiagnosis, input.postOpDiagnosis]) {
      if (!(await getConcept(tx, 'icd10', dx.icd10))?.active) {
        throw new AppError('VALIDATION_FAILED', `Diagnosa ${dx.icd10} bukan ICD-10 dari data rujukan`, 422);
      }
    }
    for (const code of input.procedureCodes) {
      if (!(await getConcept(tx, 'icd9cm', code))?.active) {
        throw new AppError('VALIDATION_FAILED', `Tindakan ${code} bukan ICD-9-CM dari data rujukan`, 422);
      }
    }
    if (input.revision.kind === 'baru') {
      const existing = await tx.operativeReport.findFirst({
        where: { surgeryCaseId: c.id, addendumOf: null, status: 'final', supersededBy: { none: {} } },
        select: { id: true },
      });
      if (existing) {
        throw new AppError(
          'CONFLICT',
          'Laporan operasi kasus ini sudah ada; buat koreksi atau addendum',
          409,
        );
      }
    }
    const now = new Date();
    const fields = await this.records.prepare('operative_reports', {
      patientId: c.patientId,
      encounterId: c.encounterId,
      occurredAt: now,
      revision: input.revision,
    });
    await this.records.insert(() =>
      tx.operativeReport.create({
        data: {
          ...fields,
          encounterId: c.encounterId,
          surgeryCaseId: c.id,
          preOpDiagnosis: input.preOpDiagnosis,
          postOpDiagnosis: input.postOpDiagnosis,
          procedureCodes: input.procedureCodes,
          findings: input.findings,
          complications: input.complications,
          bloodLossMl: input.bloodLossMl,
          implants: input.implants,
          paSpecimen: input.paSpecimen,
        },
      }),
    );
    const sc = await tx.surgeryCase.findUniqueOrThrow({
      where: { id: c.id },
      select: { caseNo: true, procedureName: true, room: { select: { name: true } } },
    });
    await this.signing.issueSigned('operative_reports', fields.id, {
      patientId: c.patientId,
      kind: 'lainnya',
      title: REPORT_TITLE[input.revision.kind],
      fileName: `${REPORT_TITLE[input.revision.kind].toLowerCase()} ${sc.caseNo} v${fields.version}`,
      number: sc.caseNo,
      issuedAt: now,
      patientExtra: [
        { label: 'Kasus', value: sc.caseNo },
        { label: 'Kamar', value: sc.room.name },
      ],
      sections: [
        {
          title: REPORT_TITLE[input.revision.kind],
          blocks: [
            {
              kind: 'fields',
              rows: [
                { label: 'Tindakan', value: sc.procedureName },
                { label: 'Waktu', value: `${formatTanggalWaktu(now)} WIB` },
                {
                  label: 'Diagnosa pra-bedah',
                  value: `${input.preOpDiagnosis.icd10} · ${input.preOpDiagnosis.label}`,
                },
                {
                  label: 'Diagnosa pasca-bedah',
                  value: `${input.postOpDiagnosis.icd10} · ${input.postOpDiagnosis.label}`,
                },
                { label: 'Kode tindakan (ICD-9-CM)', value: input.procedureCodes.join(', ') },
                { label: 'Temuan', value: input.findings },
                { label: 'Komplikasi', value: input.complications || 'Tidak ada' },
                { label: 'Perdarahan', value: `${input.bloodLossMl} mL` },
                { label: 'Implan', value: input.implants || 'Tidak ada' },
                { label: 'Spesimen PA', value: input.paSpecimen ? 'Ya' : 'Tidak' },
                ...(input.revision.kind === 'koreksi'
                  ? [{ label: 'Alasan koreksi', value: input.revision.correctionReason }]
                  : []),
              ],
            },
          ],
        },
      ],
      tte: { role: 'Operator', caption: null },
    });
    this.db.audit({
      action: input.revision.kind === 'koreksi' ? 'correct' : 'create',
      resourceType: 'operative_report',
      resourceId: fields.id,
      patientId: c.patientId,
      reason: input.revision.kind === 'koreksi' ? input.revision.correctionReason : null,
      details: { surgeryCaseId: c.id, version: fields.version, revision: input.revision.kind },
    });
    return this.board.one(c.id);
  }

  // ───────────────────────────── Spesimen PA (4.7b) ─────────────────────────────

  /**
   * Kirim spesimen terstruktur dari laporan operasi terkini (operator). Setiap spesimen = baris `surgery_specimens`
   * (append-only, label `OK-…-S<n>`) + event `surgery.specimen_sent` → order PA oleh S02 (4.8).
   */
  async specimens(caseId: string, raw: SurgerySpecimenInput): Promise<SurgeryCaseView> {
    const input = surgerySpecimenInputSchema.parse(raw);
    const c = await this.lockCase(caseId);
    if (c.status === 'batal') throw new AppError('CONFLICT', 'Kasus operasi sudah batal', 409);
    const tx = this.db.tx();
    const me = this.me();
    const operator = await tx.surgeryCaseTeam.findFirst({
      where: { surgeryCaseId: c.id, userId: me, role: 'operator', endedAt: null },
      select: { id: true },
    });
    if (!operator) throw new AppError('FORBIDDEN', 'Spesimen PA dikirim operator dari laporan operasi', 403);
    const report = await tx.operativeReport.findFirst({
      where: { surgeryCaseId: c.id, addendumOf: null, status: 'final', supersededBy: { none: {} } },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, paSpecimen: true },
    });
    if (!report) {
      throw supportError('CHECKLIST_ORDER', undefined, 'Kirim spesimen setelah laporan operasi tersimpan');
    }
    if (!report.paSpecimen) {
      throw new AppError(
        'CONFLICT',
        'Laporan operasi menyatakan tanpa spesimen PA; koreksi laporan lebih dulu',
        409,
      );
    }
    const last = await tx.surgerySpecimen.findFirst({
      where: { surgeryCaseId: c.id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const enc = await this.encounterOf(c);
    let seq = last?.seq ?? 0;
    const ids: string[] = [];
    for (const item of input.items) {
      seq += 1;
      const id = newId();
      await tx.surgerySpecimen.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          surgeryCaseId: c.id,
          operativeReportId: report.id,
          seq,
          site: item.site,
          examination: item.examination,
          containers: item.containers,
          fixative: item.fixative,
          clinicalNote: item.clinicalNote,
          cito: item.cito,
          sentBy: me,
        },
      });
      ids.push(id);
      await this.events.publish('surgery.specimen_sent', {
        surgerySpecimenId: id,
        surgeryCaseId: c.id,
        operativeReportId: report.id,
        encounterId: c.encounterId,
        patientId: c.patientId,
        unitId: enc.unitId,
        examination: item.examination,
        cito: item.cito,
      });
    }
    this.db.audit({
      action: 'create',
      resourceType: 'surgery_specimen',
      resourceId: c.id,
      patientId: c.patientId,
      details: { surgeryCaseId: c.id, specimenIds: ids, operativeReportId: report.id },
    });
    return this.board.one(c.id);
  }

  /** Kunjungan aktif untuk dijadwalkan (cari No. RM / nomor kunjungan); diaudit `search` per pasien. */
  async candidates(q: string) {
    await this.scope.assertUnit();
    const term = q.trim();
    const rows = await this.db.tx().encounter.findMany({
      where: {
        status: { in: ACTIVE_ENCOUNTER },
        OR: [{ number: { contains: term.toUpperCase() } }, { patient: { mrn: { contains: term } } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        number: true,
        encounterClass: true,
        patient: { select: { id: true, name: true, mrn: true } },
      },
    });
    for (const r of rows)
      this.db.audit({ action: 'search', resourceType: 'surgery_candidate', patientId: r.patient.id });
    return {
      items: rows.map((r) => ({
        encounterId: r.id,
        number: r.number,
        encounterClass: r.encounterClass,
        patientName: r.patient.name,
        rm: r.patient.mrn,
      })),
    };
  }

  /** Kasus boleh dibuka pelaku (lingkup `surgery.read`); diaudit `read`. */
  async assertReadable(id: string): Promise<void> {
    const c = await this.scope.loadCase(id);
    this.db.audit({ action: 'read', resourceType: 'surgery_case', resourceId: c.id, patientId: c.patientId });
  }

  /** Staf aktif untuk susunan tim operasi (dokter, residen, perawat): nama + peran saja. */
  async staff(): Promise<{ items: Array<{ userId: string; name: string; role: string }> }> {
    await this.scope.assertUnit();
    const at = new Date();
    const rows = await this.db.tx().staffAssignment.findMany({
      where: {
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        role: { code: { in: ['dokter', 'dokter_residen', 'perawat'] }, active: true },
        user: { status: 'active' },
      },
      select: { userId: true, user: { select: { displayName: true } }, role: { select: { code: true } } },
      orderBy: [{ user: { displayName: 'asc' } }],
      // Tanpa batas: daftar nama staf klinis satu RS (ratusan), dipakai pilihan tim operasi.
      take: 2000,
    });
    const seen = new Set<string>();
    const items: Array<{ userId: string; name: string; role: string }> = [];
    for (const r of rows) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      items.push({ userId: r.userId, name: r.user.displayName, role: r.role.code });
    }
    return { items };
  }

  // ───────────────────────────── Bantu ─────────────────────────────

  /** Pelaku memegang izin tambahan (mis. `surgery.override`) di matriks perannya. */
  private async holds(resource: string, action: string): Promise<boolean> {
    const actor = this.db.actor();
    if (!actor.role || actor.devicePrincipal) return false;
    if (actor.role === DEV_ROLE) return true;
    return (await this.matrix.scope(this.db.tenantId(), actor.role, resource, action)) !== null;
  }

  /** Kunci kasus (urutan aksi serentak satu kasus) + lingkup; `active` = bukan batal/selesai. */
  private async lockCase(id: string, active = false): Promise<CaseRow> {
    await this.db.tx().$queryRaw`SELECT id FROM surgery_cases WHERE id = ${id}::uuid FOR UPDATE`;
    return active ? this.scope.activeCase(id) : this.scope.loadCase(id);
  }

  /**
   * Kasus batal: keanggotaan rawat bersama dokter tim yang dibuat jadwal ini diakhiri, kecuali dokter itu masih di tim
   * kasus operasi aktif lain kunjungan yang sama (relasi berlaku sampai akhir hari berikutnya, ADR-0031).
   */
  private async releaseTeam(c: CaseRow): Promise<void> {
    const tx = this.db.tx();
    const doctors = await tx.surgeryCaseTeam.findMany({
      where: { surgeryCaseId: c.id, endedAt: null, role: { in: [...DOCTOR_TEAM_ROLES] } },
      select: { userId: true },
    });
    for (const { userId } of doctors) {
      const other = await tx.surgeryCaseTeam.findFirst({
        where: {
          userId,
          endedAt: null,
          surgeryCase: { encounterId: c.encounterId, id: { not: c.id }, status: { notIn: ['batal'] } },
        },
        select: { id: true },
      });
      if (other) continue;
      const member = await tx.encounterParticipant.findFirst({
        where: { encounterId: c.encounterId, userId, role: 'rawat_bersama', endedAt: null },
        select: { id: true },
      });
      if (member) await this.careTeam.end(member.id, 'Operasi dibatalkan');
    }
  }

  private async systemCheck(caseId: string, phase: ChecklistPhaseId, itemCode: string): Promise<void> {
    const tx = this.db.tx();
    const exists = await tx.surgicalSafetyCheck.findFirst({
      where: { surgeryCaseId: caseId, phase, itemCode },
      select: { id: true },
    });
    if (exists) return;
    await mapSurgeryDb(() =>
      tx.surgicalSafetyCheck.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          surgeryCaseId: caseId,
          phase,
          itemCode,
          source: 'system',
          checkedBy: this.me(),
        },
      }),
    );
  }

  private history(caseId: string, from: string | null, to: string, reason: string | null) {
    return this.db.tx().surgeryCaseStatusHistory.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        surgeryCaseId: caseId,
        fromStatus: from,
        toStatus: to,
        changedBy: this.db.actorUserId(),
        reason,
      },
    });
  }

  private async encounterOf(c: CaseRow): Promise<{ unitId: string }> {
    return this.db
      .tx()
      .encounter.findUniqueOrThrow({ where: { id: c.encounterId }, select: { unitId: true } });
  }

  private async okDepot(): Promise<string> {
    const depot = await this.db.tx().stockLocation.findFirst({
      where: { kind: 'ok', active: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (!depot) throw new AppError('NOT_FOUND', 'Depo kamar operasi belum diatur', 404);
    return depot.id;
  }

  private me(): string {
    const id = this.db.actorUserId();
    if (!id) throw new AppError('FORBIDDEN', 'Hanya staf yang masuk', 403);
    return id;
  }
}
