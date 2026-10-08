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
  MEDICATION_FREQUENCIES,
  newId,
  wristbandScanValid,
  type EmarBoard,
  type MedicationAdministrationInput,
  type MedicationAdministrationRecord,
  type MedicationDoubleCheckInput,
  type MedicationFrequency,
  type WristbandScanInput,
  type ActiveWristbandScan,
  type DoubleCheckView,
  MEDICATION_ADMINISTRATION_STATUSES,
} from '@simrs/shared';
import { z } from 'zod';
import { clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { DispensingService } from '../dispensing/dispensing.service';
import { MedicationSchedulesService } from './medication-schedules.service';

/** Isi dosis beku atestasi cek ganda (`medication_double_checks.content`, ditulis `doubleCheck`). */
const doubleCheckContentSchema = z.object({
  scheduleId: z.uuid().nullable(),
  labelCode: z.string(),
  status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
  occurredAt: z.iso.datetime({ offset: true }),
  reason: z.string().nullable(),
});

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
    private readonly dispensing: DispensingService,
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
    // Label = etiket farmasi (`OBT-…`, 4.6b, F3-5) dari obat yang sudah diserahkan untuk order ini, atau label lokal
    // stok ruangan = UUID baris order obat (juga untuk racikan). Tagihan obat: farmasi saat serah (keputusan fase 4
    // no. 11); eMAR hanya menagih stok ruangan.
    const wardStock = input.labelCode === med.id;
    if (!wardStock) {
      const label = await this.dispensing.resolveLabel(input.labelCode);
      if (label?.medicationRequestId !== med.id)
        throw invalid('Label obat tidak sesuai dengan order dosis ini');
      if (!label.handedOver) throw conflict('Obat berlabel ini belum diserahkan farmasi');
    }
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
      // Telaah farmasi 4.5: order harus lolos telaah (setujui, atau sebagian yang memuat order ini).
      const rx = await tx.pharmacyPrescription.findUnique({
        where: { tenantId_orderGroupId: { tenantId, orderGroupId: med.orderGroupId } },
        select: {
          reviews: {
            orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { decision: true, medicationRequestIds: true },
          },
        },
      });
      const review = rx?.reviews[0];
      const approved =
        review?.decision === 'setujui' ||
        (review?.decision === 'sebagian' && review.medicationRequestIds.includes(med.id));
      if (!approved) throw conflict('Telaah farmasi diwajibkan RS; order ini belum lolos telaah farmasi');
    }
    return { med, enc, scan, late, author, occurredAt, now, wardStock };
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
    if (input.status === 'given' && dose.wardStock)
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
      wardStock: dose.wardStock,
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
    const rows = await this.db.tx().medicationAdministration.findMany({
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

  /**
   * Pindaian gelang cocok yang masih berlaku untuk kunjungan ini (gelang aktif, umur ≤ `emar.scan_valid_minutes`), dari
   * petugas mana pun. Dipakai perawat kedua memilih pindaian rekan yang akan ia periksa (cek ganda dua sesi, ADR-0077);
   * pindaian tetap hanya berlaku untuk pemberian oleh pemiliknya.
   */
  async activeScans(encounterId: string): Promise<ActiveWristbandScan[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const tx = this.db.tx();
    const [{ now }] = await tx.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
    const validMinutes = await readTenantSetting(tx, 'emar.scan_valid_minutes');
    const rows = await tx.wristbandScan.findMany({
      where: {
        encounterId: enc.id,
        matched: true,
        scannedAt: { gte: new Date(now.getTime() - validMinutes * 60_000), lte: now },
        wristband: { voidedAt: null },
      },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ scannedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    this.db.audit({
      action: 'read',
      resourceType: 'wristband_scan',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return rows.map((r) => ({
      id: r.id,
      by: { userId: r.user.id, nama: r.user.displayName },
      scannedAt: r.scannedAt.toISOString(),
      validUntil: new Date(r.scannedAt.getTime() + validMinutes * 60_000).toISOString(),
    }));
  }

  /**
   * Atestasi cek ganda atas pindaian kunjungan ini yang masih berlaku. Pemberi obat memakai isi dosis beku di sini
   * (waktu, label, alasan) agar pemberiannya cocok dengan atestasi (ADR-0077); `used` = sudah dipakai pemberian.
   */
  async doubleChecks(encounterId: string): Promise<DoubleCheckView[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const tx = this.db.tx();
    const [{ now }] = await tx.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
    const validMinutes = await readTenantSetting(tx, 'emar.scan_valid_minutes');
    const rows = await tx.medicationDoubleCheck.findMany({
      where: {
        wristbandScan: {
          encounterId: enc.id,
          scannedAt: { gte: new Date(now.getTime() - validMinutes * 60_000) },
        },
      },
      include: {
        user: { select: { id: true, displayName: true } },
        administrations: { select: { id: true }, take: 1 },
      },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    this.db.audit({
      action: 'read',
      resourceType: 'medication_double_check',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return rows.flatMap((r) => {
      const c = doubleCheckContentSchema.safeParse(r.content);
      if (!c.success) return [];
      return [
        {
          id: r.id,
          scanId: r.wristbandScanId,
          medicationRequestId: r.medicationRequestId,
          scheduleId: c.data.scheduleId,
          labelCode: c.data.labelCode,
          status: c.data.status,
          occurredAt: c.data.occurredAt,
          reason: c.data.reason,
          checkedBy: { userId: r.user.id, nama: r.user.displayName, peran: r.userRole },
          checkedAt: r.checkedAt.toISOString(),
          used: r.administrations.length > 0,
        },
      ];
    });
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
      // Aturan pakai berlabel ("3×1 (tiap 8 jam)"), bukan kode mentah (`3x1`), sama seperti ringkasan pasien.
      sig: `${m.dose} · ${m.route} · ${MEDICATION_FREQUENCIES[m.frequency as MedicationFrequency]?.label ?? m.frequency}`.slice(
        0,
        160,
      ),
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
