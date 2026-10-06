import { Injectable } from '@nestjs/common';
import { Prisma, readTenantSetting } from '@simrs/db';
import {
  AppError,
  clinicalError,
  emarIsLate,
  emarSlotState,
  EMAR_EARLY_WINDOW_MINUTES,
  formatJam,
  isoDateJakarta,
  jakartaWallTime,
  newId,
  wristbandScanValid,
  type EmarBoard,
  type MedicationAdministrationInput,
  type MedicationAdministrationRecord,
  type MedicationDoubleCheckInput,
  type MedicationFrequency,
  type WristbandScanInput,
} from '@simrs/shared';
import { clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { MedicationSchedulesService } from './medication-schedules.service';

const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 422);
const conflict = (message: string) => new AppError('CONFLICT', message, 409);
type DoseInput = Omit<MedicationAdministrationInput, 'doubleCheckId' | 'doubleCheckUserId'>;

@Injectable()
export class EmarService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly schedules: MedicationSchedulesService,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
    private readonly events: DomainEvents,
  ) {}

  async scan(input: WristbandScanInput) {
    const author = this.records.author();
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    if (enc.status !== 'in_progress')
      throw conflict('Pindaian obat hanya untuk kunjungan yang sedang berjalan');
    const band = await this.db.tx().patientWristband.findFirst({
      where: { encounterId: enc.id, code: input.code, voidedAt: null },
      select: { id: true },
    });
    const row = await this.db.tx().wristbandScan.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId: enc.id,
        patientId: enc.patientId,
        wristbandId: band?.id ?? null,
        matched: !!band,
        scannedCode: input.code,
        userId: author.userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'wristband_scan',
      resourceId: row.id,
      patientId: enc.patientId,
      outcome: band ? 'success' : 'denied',
      details: { encounterId: enc.id, matched: !!band },
    });
    return { id: row.id, matched: row.matched, scannedAt: row.scannedAt.toISOString() };
  }

  /** Kunci sama dengan pembatalan CPOE; batal dan pemberian tidak bisa lolos berbarengan. */
  private async dose(input: DoseInput, checking: boolean) {
    const author = this.records.author();
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:orders.line:${input.medicationRequestId}`}, 0))`;
    const med = await tx.medicationRequest.findUnique({ where: { id: input.medicationRequestId } });
    if (!med) throw new AppError('NOT_FOUND', 'Order obat tidak ditemukan', 404);
    await tx.$queryRaw`SELECT id FROM encounters WHERE tenant_id = ${tenantId}::uuid AND id = ${med.encounterId}::uuid FOR SHARE`;
    const enc = await clinicalEncounter(this.db, this.access, med.encounterId, 'write');
    if (enc.status !== 'in_progress')
      throw conflict('Pemberian obat hanya untuk kunjungan yang sedang berjalan');
    const status = await tx.orderStatusEvent.findFirst({
      where: { medicationRequestId: med.id },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    });
    if (status?.status !== 'aktif') throw conflict('Order obat sudah dibatalkan atau tidak aktif');
    // Sampai label farmasi fase 4 tersedia, label lokal adalah UUID baris order obat (juga berlaku untuk racikan).
    if (input.labelCode !== med.id) throw invalid('Label obat tidak sesuai dengan order dosis ini');
    const scan = await tx.wristbandScan.findUnique({ where: { id: input.scanId } });
    const [{ now }] = await tx.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
    const validMinutes = await readTenantSetting(tx, 'emar.scan_valid_minutes');
    if (
      !scan ||
      !wristbandScanValid(
        scan,
        { encounterId: enc.id, userId: checking ? scan.userId : author.userId, at: now },
        validMinutes,
      )
    ) {
      throw clinicalError('WRISTBAND_SCAN_REQUIRED');
    }
    const bands = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM patient_wristbands
      WHERE tenant_id = ${tenantId}::uuid AND id = ${scan.wristbandId}::uuid AND voided_at IS NULL FOR SHARE`;
    if (bands.length === 0) throw clinicalError('WRISTBAND_SCAN_REQUIRED');
    if (checking && scan.userId === author.userId) throw clinicalError('DOUBLE_CHECK_REQUIRED');
    const suppliedAt = new Date(input.occurredAt);
    if (
      suppliedAt.getTime() < scan.scannedAt.getTime() - 5000 ||
      suppliedAt.getTime() > now.getTime() + 300_000
    ) {
      throw invalid('Waktu pemberian harus setelah pindaian gelang dan tidak di masa depan');
    }
    // Selisih jam/ketelitian klien ≤ 5 detik dinormalisasi ke pindaian server; urutan gelang → dosis tetap terjaga.
    const occurredAt = new Date(Math.max(suppliedAt.getTime(), scan.scannedAt.getTime()));
    const scheduled = med.frequency !== 'prn' && med.frequency !== 'stat';
    if (scheduled !== (input.scheduleId !== null))
      throw invalid('Order terjadwal wajib jadwal dosis; PRN/stat tanpa jadwal');
    const slot = input.scheduleId
      ? await tx.medicationSchedule.findUnique({ where: { id: input.scheduleId } })
      : null;
    if (input.scheduleId && (!slot || slot.medicationRequestId !== med.id))
      throw invalid('Jadwal bukan milik order obat ini');
    const at = slot?.scheduledAt ?? med.createdAt;
    if (scheduled && now.getTime() < at.getTime() - EMAR_EARLY_WINDOW_MINUTES * 60_000)
      throw conflict('Dosis belum masuk jendela pemberian');
    if (scheduled && occurredAt.getTime() < at.getTime() - EMAR_EARLY_WINDOW_MINUTES * 60_000)
      throw invalid('Waktu pemberian lebih awal dari jendela dosis');
    const days = Math.floor(
      (Date.parse(`${isoDateJakarta(now)}T00:00:00Z`) -
        Date.parse(`${isoDateJakarta(med.createdAt)}T00:00:00Z`)) /
        86_400_000,
    );
    if (med.durationDays !== null && days >= med.durationDays)
      throw conflict('Durasi order obat sudah berakhir');
    if (
      await tx.medicationAdministration.findFirst({
        where: {
          medicationRequestId: med.id,
          status: 'given',
          ...(slot ? { scheduleId: slot.id } : med.frequency === 'stat' ? {} : { wristbandScanId: scan.id }),
        },
      })
    )
      throw clinicalError('MEDICATION_ALREADY_GIVEN');
    const lateMinutes = await readTenantSetting(tx, 'emar.late_minutes');
    const late =
      med.frequency !== 'prn' &&
      emarIsLate(at, new Date(Math.max(now.getTime(), occurredAt.getTime())), lateMinutes);
    if ((late || input.status !== 'given') && (input.reason ?? '').trim().length < 10)
      throw invalid('Pemberian terlambat, ditunda, atau ditolak wajib alasan minimal 10 karakter');
    if (input.status === 'given' && (await readTenantSetting(tx, 'emar.require_pharmacy_review'))) {
      throw conflict('Telaah farmasi diwajibkan RS; sambungan telaah farmasi fase 4 belum tersedia');
    }
    return { med, enc, scan, late, author, occurredAt, now };
  }

  async doubleCheck(input: MedicationDoubleCheckInput) {
    const dose = await this.dose(input, true);
    if (!dose.med.highAlert || !['perawat', 'bidan'].includes(dose.author.role))
      throw clinicalError('DOUBLE_CHECK_REQUIRED');
    const check = await this.db.tx().medicationDoubleCheck.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        medicationRequestId: dose.med.id,
        wristbandScanId: dose.scan.id,
        userId: dose.author.userId,
        userRole: dose.author.role,
        content: { ...input, occurredAt: dose.occurredAt.toISOString() } as Prisma.InputJsonValue,
      },
    });
    this.db.audit({
      action: 'verify',
      resourceType: 'medication_double_check',
      resourceId: check.id,
      patientId: dose.enc.patientId,
      details: { medicationRequestId: dose.med.id, scanId: dose.scan.id },
    });
    return { id: check.id, userId: check.userId, checkedAt: check.checkedAt.toISOString() };
  }

  async administer(input: MedicationAdministrationInput): Promise<MedicationAdministrationRecord> {
    const { doubleCheckId, doubleCheckUserId, ...content } = input;
    const dose = await this.dose(content, false);
    let checker: { id: string; userId: string } | null = null;
    if (doubleCheckId) {
      const check = await this.db.tx().medicationDoubleCheck.findUnique({ where: { id: doubleCheckId } });
      const normalized = { ...content, occurredAt: dose.occurredAt.toISOString() };
      if (
        !check ||
        check.userId === dose.author.userId ||
        check.medicationRequestId !== dose.med.id ||
        check.wristbandScanId !== dose.scan.id ||
        check.checkedAt.getTime() > dose.now.getTime() ||
        JSON.stringify(check.content, Object.keys(normalized).sort()) !==
          JSON.stringify(normalized, Object.keys(normalized).sort()) ||
        (doubleCheckUserId !== null && doubleCheckUserId !== check.userId)
      )
        throw clinicalError('DOUBLE_CHECK_REQUIRED');
      checker = check;
    } else if (doubleCheckUserId !== null || (dose.med.highAlert && input.status === 'given')) {
      throw clinicalError('DOUBLE_CHECK_REQUIRED');
    }
    const id = newId();
    await this.records.insert(() =>
      this.db.tx().medicationAdministration.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          medicationRequestId: dose.med.id,
          scheduleId: input.scheduleId,
          encounterId: dose.enc.id,
          patientId: dose.enc.patientId,
          wristbandScanId: dose.scan.id,
          status: input.status,
          occurredAt: dose.occurredAt,
          userId: dose.author.userId,
          userRole: dose.author.role,
          late: dose.late,
          reason: input.reason,
          labelCode: input.labelCode,
          doubleCheckId: checker?.id ?? null,
          doubleCheckUserId: checker?.userId ?? null,
        },
      }),
    );
    await this.satusehat.record('MedicationAdministration', id);
    if (input.status === 'given')
      await this.billable.record({
        encounterId: dose.enc.id,
        patientId: dose.enc.patientId,
        sourceType: 'medication_administrations',
        sourceId: id,
        kind: 'obat',
        occurredAt: dose.occurredAt,
      });
    await this.events.publish('medication.administered', {
      administrationId: id,
      medicationRequestId: dose.med.id,
      encounterId: dose.enc.id,
      patientId: dose.enc.patientId,
      status: input.status,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'medication_administration',
      resourceId: id,
      patientId: dose.enc.patientId,
      details: {
        medicationRequestId: dose.med.id,
        status: input.status,
        late: dose.late,
        doubleCheckId: checker?.id ?? null,
      },
    });
    return (await this.present([id]))[0] as MedicationAdministrationRecord;
  }

  private async present(ids: string[]): Promise<MedicationAdministrationRecord[]> {
    const rows = await this.db
      .tx()
      .medicationAdministration.findMany({
        where: { id: { in: ids } },
        include: { user: true, doubleCheck: { include: { user: true } } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      });
    return rows.map((r) => ({
      id: r.id,
      status: r.status as MedicationAdministrationRecord['status'],
      at: r.occurredAt.toISOString(),
      by: { userId: r.userId, nama: r.user.displayName, peran: r.userRole },
      late: r.late,
      reason: r.reason,
      doubleCheckedBy: r.doubleCheck
        ? {
            userId: r.doubleCheck.userId,
            nama: r.doubleCheck.user.displayName,
            peran: r.doubleCheck.userRole,
          }
        : null,
      medicationRequestId: r.medicationRequestId,
      scheduleId: r.scheduleId,
      scanId: r.wristbandScanId,
      labelCode: r.labelCode,
    }));
  }

  async board(encounterId: string, date = isoDateJakarta(new Date())): Promise<EmarBoard> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const tx = this.db.tx();
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const from = jakartaWallTime(y, m, d, 0, 0);
    const to = new Date(from.getTime() + 86_400_000);
    const meds = await tx.medicationRequest.findMany({
      where: { encounterId: enc.id },
      include: { drug: true, statusEvents: { orderBy: [{ changedAt: 'desc' }, { id: 'desc' }], take: 1 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const active = meds.filter((m) => m.statusEvents[0]?.status === 'aktif');
    // Pengisian idempoten satu hari untuk order lama; tidak ada harga/efek sistem luar.
    if (enc.status === 'in_progress')
      await this.schedules.ensureDay(
        tx,
        this.db.tenantId(),
        active.map((m) => m.id),
        date,
      );
    const slots = await tx.medicationSchedule.findMany({
      where: { encounterId: enc.id, scheduledAt: { gte: from, lt: to } },
      orderBy: { scheduledAt: 'asc' },
    });
    const rows = await tx.medicationAdministration.findMany({
      where: {
        encounterId: enc.id,
        OR: [{ scheduleId: { in: slots.map((s) => s.id) } }, { occurredAt: { gte: from, lt: to } }],
      },
      select: { id: true },
    });
    const administrations = await this.present(rows.map((r) => r.id));
    const lateMinutes = await readTenantSetting(tx, 'emar.late_minutes');
    const orders = active.map((m) => ({
      medicationRequestId: m.id,
      name: m.name,
      sig: `${m.dose} · ${m.route} · ${m.frequency}`.slice(0, 160),
      frequency: m.frequency as MedicationFrequency,
      kfa: m.drug?.codeSystem === 'kfa' ? m.drug.code : null,
      highAlert: m.highAlert,
      slots: slots
        .filter((s) => s.medicationRequestId === m.id)
        .map((s) => {
          const matching = administrations.filter((a) => a.scheduleId === s.id);
          const a = matching.find((a) => a.status === 'given') ?? matching[0] ?? null;
          const administration = a
            ? {
                id: a.id,
                status: a.status,
                at: a.at,
                by: a.by,
                late: a.late,
                reason: a.reason,
                doubleCheckedBy: a.doubleCheckedBy,
              }
            : null;
          return {
            scheduleId: s.id,
            scheduledAt: s.scheduledAt.toISOString(),
            time: formatJam(s.scheduledAt),
            state: emarSlotState({
              scheduledAt: s.scheduledAt,
              now: new Date(),
              administration,
              lateMinutes,
            }),
            administration,
          };
        }),
    }));
    this.db.audit({
      action: 'read',
      resourceType: 'emar',
      patientId: enc.patientId,
      details: { encounterId: enc.id, date, orders: orders.length },
    });
    return { encounterId: enc.id, date, orders, administrations };
  }
}
