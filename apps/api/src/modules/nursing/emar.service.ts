import { Injectable } from '@nestjs/common';
import { readTenantSetting, type TenantTx, uniqueViolationTarget } from '@simrs/db';
import {
  AppError,
  clinicalError,
  type EmarApi,
  type EmarOrder,
  emarIsLate,
  emarScheduleForDay,
  emarScheduleTimes,
  emarSlotState,
  formatJam,
  isoDateJakarta,
  jakartaWallTime,
  MEDICATION_FREQUENCIES,
  type MedicationAdministrationInput,
  type MedicationAdministrationRecord,
  type MedicationFrequency,
  newId,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { clinicalEncounter } from '../../infra/clinical/clinical-context';
import { clinicalDbError, ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

const DAY_MS = 86_400_000;
const ACTIVE_ENCOUNTER = ['arrived', 'in_progress'];
/** Peran yang boleh menjadi pemeriksa kedua obat kewaspadaan tinggi (izin `medication.administer` bawaan). */
const DOUBLE_CHECK_ROLES = ['perawat', 'bidan'];

const alnum = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');

type OrderRow = {
  id: string;
  encounterId: string;
  patientId: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  customTimes: string[];
  durationDays: number | null;
  highAlert: boolean;
  createdAt: Date;
  drug: { code: string | null; codeSystem: string | null } | null;
  statusEvents: Array<{ status: string; changedAt: Date }>;
};

const ORDER_SELECT = {
  id: true,
  encounterId: true,
  patientId: true,
  name: true,
  dose: true,
  route: true,
  frequency: true,
  customTimes: true,
  durationDays: true,
  highAlert: true,
  createdAt: true,
  drug: { select: { code: true, codeSystem: true } },
  statusEvents: { orderBy: { changedAt: 'desc' }, select: { status: true, changedAt: true } },
} as const;

/** Saat order berhenti memberi dosis baru: dibatalkan/selesai, atau akhir lama pemberian; null = masih berjalan. */
function stopAt(o: OrderRow): Date | null {
  const latest = o.statusEvents[0];
  const stopped = latest && latest.status !== 'aktif' ? latest.changedAt : null;
  const durationEnd = o.durationDays ? new Date(o.createdAt.getTime() + o.durationDays * DAY_MS) : null;
  if (stopped && durationEnd) return stopped < durationEnd ? stopped : durationEnd;
  return stopped ?? durationEnd;
}

const scheduled = (frequency: string) => frequency !== 'prn' && frequency !== 'stat';

/** Kode label yang diterima: id order (label farmasi) atau KFA obat tunggal. */
function labelMatches(code: string, o: OrderRow): boolean {
  const c = alnum(code);
  if (c.length === 0) return false;
  if (c === alnum(o.id)) return true;
  return o.drug?.codeSystem === 'kfa' && !!o.drug.code && c === alnum(o.drug.code);
}

/**
 * K12 · eMAR (potongan 3.5, rencana §3.5): jadwal dosis dibentuk dari order obat aktif (jam WIB dari frekuensi atau
 * jam khusus order, `emarScheduleTimes`) saat grid hari itu dibuka; PRN/stat tanpa jadwal. Pemberian wajib pindaian
 * gelang cocok milik perawat yang sama ≤ `emar.scan_valid_minutes` (dijaga trigger database), label obat cocok dengan
 * order, satu "diberikan" per jadwal, terlambat/ditunda/ditolak beralasan, obat kewaspadaan tinggi dicek perawat
 * kedua. Pemberian = biaya `obat` (ADR-0032), SATUSEHAT MedicationAdministration `held`, event
 * `medication.administered`. Tanpa gerbang telaah farmasi di fase 3.
 */
@Injectable()
export class EmarService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly billable: BillableRecorder,
    private readonly satusehat: SatusehatRecorder,
    private readonly events: DomainEvents,
  ) {}

  /** Grid eMAR satu hari WIB (bawaan hari ini). Jadwal hari itu dibentuk bila belum ada (idempoten). */
  async emar(encounterId: string, date?: string, now: Date = new Date()): Promise<EmarApi> {
    const tx = this.db.tx();
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const day = date ?? isoDateJakarta(now);
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    const from = jakartaWallTime(y, m, d);
    const to = new Date(from.getTime() + DAY_MS);
    const [lateMinutes, scanValidMinutes] = await Promise.all([
      readTenantSetting(tx, 'emar.late_minutes'),
      readTenantSetting(tx, 'emar.scan_valid_minutes'),
    ]);
    const orders = (await tx.medicationRequest.findMany({
      where: { encounterId: enc.id, createdAt: { lt: to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ORDER_SELECT,
    })) as OrderRow[];
    await this.materialize(tx, orders, day);

    const ids = orders.map((o) => o.id);
    const [schedules, administrations] = await Promise.all([
      tx.medicationSchedule.findMany({
        where: { medicationRequestId: { in: ids }, scheduledAt: { gte: from, lt: to } },
        orderBy: { scheduledAt: 'asc' },
      }),
      tx.medicationAdministration.findMany({
        where: { medicationRequestId: { in: ids } },
        orderBy: { recordedAt: 'asc' },
        include: { wristbandScan: { select: { method: true } } },
      }),
    ]);
    const names = await this.records.userNames(
      administrations.flatMap((a) => [a.userId, ...(a.doubleCheckUserId ? [a.doubleCheckUserId] : [])]),
    );
    const present = (a: (typeof administrations)[number]): MedicationAdministrationRecord =>
      this.present(a, names, a.wristbandScan.method);

    const result: EmarOrder[] = [];
    for (const o of orders) {
      const stop = stopAt(o);
      const mine = administrations.filter((a) => a.medicationRequestId === o.id);
      const slots = schedules
        .filter((s) => s.medicationRequestId === o.id)
        .flatMap((s) => {
          const recorded = mine.filter((a) => a.scheduleId === s.id);
          const given = recorded.find((a) => a.status === 'given');
          const adm = given ?? recorded.at(-1) ?? null;
          // Jadwal sesudah order berhenti tidak tampil, kecuali sudah ada catatannya.
          if (!adm && stop && s.scheduledAt >= stop) return [];
          const r = adm ? present(adm) : null;
          return [
            {
              scheduleId: s.id,
              scheduledAt: s.scheduledAt.toISOString(),
              time: formatJam(s.scheduledAt),
              state: emarSlotState({ scheduledAt: s.scheduledAt, now, administration: adm, lateMinutes }),
              administration: r
                ? {
                    id: r.id,
                    status: r.status,
                    at: r.occurredAt,
                    by: r.by,
                    late: r.late,
                    reason: r.reason,
                    doubleCheckedBy: r.doubleCheckedBy,
                  }
                : null,
            },
          ];
        });
      const unscheduled = mine
        .filter((a) => a.scheduleId === null && a.occurredAt >= from && a.occurredAt < to)
        .map(present);
      const frequency = o.frequency as MedicationFrequency;
      result.push({
        medicationRequestId: o.id,
        name: o.name.slice(0, 120),
        sig: `${o.dose} · ${o.route} · ${MEDICATION_FREQUENCIES[frequency]?.label ?? o.frequency}`.slice(0, 160),
        frequency,
        kfa: o.drug?.codeSystem === 'kfa' && o.drug.code && /^\d{8}$/.test(o.drug.code) ? o.drug.code : null,
        highAlert: o.highAlert,
        labelCode: o.id,
        status: stop && stop <= now ? 'dihentikan' : 'aktif',
        slots,
        unscheduled,
      });
    }
    this.db.audit({
      action: 'read',
      resourceType: 'emar',
      patientId: enc.patientId,
      details: { encounterId: enc.id, date: day, orders: result.length },
    });
    return {
      encounterId: enc.id,
      date: day,
      asOf: now.toISOString(),
      lateMinutes,
      scanValidMinutes,
      orders: result,
      doubleCheckers: await this.doubleCheckers(tx, enc.unitId),
    };
  }

  async administer(input: MedicationAdministrationInput): Promise<MedicationAdministrationRecord> {
    const tx = this.db.tx();
    const order = (await tx.medicationRequest.findUnique({
      where: { id: input.medicationRequestId },
      select: ORDER_SELECT,
    })) as OrderRow | null;
    if (!order) throw new AppError('NOT_FOUND', 'Order obat tidak ditemukan', 404);
    const enc = await clinicalEncounter(this.db, this.access, order.encounterId, 'write');
    if (!ACTIVE_ENCOUNTER.includes(enc.status)) {
      throw new AppError('CONFLICT', 'Kunjungan tidak aktif; pemberian obat tidak bisa dicatat', 409);
    }
    const now = new Date();
    const occurredAt = new Date(input.occurredAt);
    const stop = stopAt(order);
    if (occurredAt < order.createdAt || (stop && occurredAt >= stop)) throw clinicalError('MEDICATION_ORDER_INACTIVE');
    if (!labelMatches(input.labelCode, order)) throw clinicalError('MEDICATION_LABEL_MISMATCH');

    const lateMinutes = await readTenantSetting(tx, 'emar.late_minutes');
    let late = false;
    if (scheduled(order.frequency)) {
      if (!input.scheduleId) {
        throw new AppError('VALIDATION_FAILED', 'Pilih jadwal dosis untuk order terjadwal', 422);
      }
      const schedule = await tx.medicationSchedule.findUnique({ where: { id: input.scheduleId } });
      if (!schedule || schedule.medicationRequestId !== order.id) {
        throw new AppError('VALIDATION_FAILED', 'Jadwal dosis bukan milik order ini', 422);
      }
      if (emarSlotState({ scheduledAt: schedule.scheduledAt, now: occurredAt, administration: null, lateMinutes }) === 'rencana') {
        throw new AppError('VALIDATION_FAILED', 'Belum waktunya dosis ini (lebih dari 60 menit sebelum jadwal)', 422);
      }
      if (input.status === 'given') {
        late = emarIsLate(schedule.scheduledAt, occurredAt, lateMinutes);
        const given = await tx.medicationAdministration.findFirst({
          where: { scheduleId: schedule.id, status: 'given' },
          select: { id: true },
        });
        if (given) throw clinicalError('MEDICATION_ALREADY_GIVEN');
      }
    } else {
      if (input.scheduleId) {
        throw new AppError('VALIDATION_FAILED', 'Order PRN/stat tidak memakai jadwal dosis', 422);
      }
      if (order.frequency === 'stat' && input.status === 'given') {
        const given = await tx.medicationAdministration.findFirst({
          where: { medicationRequestId: order.id, status: 'given' },
          select: { id: true },
        });
        if (given) throw clinicalError('MEDICATION_ALREADY_GIVEN');
      }
    }
    const reason = input.reason?.trim() || null;
    if (late && (reason ?? '').length < SAFETY_REASON_MIN) throw clinicalError('LATE_REASON_REQUIRED');

    const actor = this.db.actor();
    const userId = this.db.actorUserId();
    if (!userId || !actor.role) throw new AppError('FORBIDDEN', 'Pemberian obat butuh sesi pengguna', 403);
    if (order.highAlert && input.status === 'given') {
      if (!input.doubleCheckUserId) throw clinicalError('DOUBLE_CHECK_REQUIRED');
      await this.assertDoubleChecker(tx, input.doubleCheckUserId, userId, now);
    }

    const id = newId();
    try {
      await tx.medicationAdministration.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          medicationRequestId: order.id,
          scheduleId: input.scheduleId,
          encounterId: enc.id,
          patientId: enc.patientId,
          wristbandScanId: input.scanId,
          status: input.status,
          occurredAt,
          userId,
          userRole: actor.role,
          late,
          reason,
          doubleCheckUserId: input.status === 'given' ? input.doubleCheckUserId : null,
          labelCode: input.labelCode,
        },
      });
    } catch (err) {
      if (/medication_administrations_one_given/.test(uniqueViolationTarget(err))) {
        throw clinicalError('MEDICATION_ALREADY_GIVEN');
      }
      throw clinicalDbError(err) ?? err;
    }
    if (input.status === 'given') {
      await this.billable.record({
        encounterId: enc.id,
        patientId: enc.patientId,
        sourceType: 'medication_administrations',
        sourceId: id,
        kind: 'obat',
        occurredAt,
      });
    }
    await this.satusehat.record('MedicationAdministration', id, 1);
    await this.events.publish('medication.administered', {
      administrationId: id,
      medicationRequestId: order.id,
      encounterId: enc.id,
      patientId: enc.patientId,
      status: input.status,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'medication_administration',
      resourceId: id,
      patientId: enc.patientId,
      reason,
      details: { status: input.status, late, highAlert: order.highAlert, scheduled: input.scheduleId !== null },
    });
    const row = await tx.medicationAdministration.findUniqueOrThrow({
      where: { id },
      include: { wristbandScan: { select: { method: true } } },
    });
    const names = await this.records.userNames([row.userId, ...(row.doubleCheckUserId ? [row.doubleCheckUserId] : [])]);
    return this.present(row, names, row.wristbandScan.method);
  }

  /** Bentuk jadwal hari `day` (WIB) untuk order terjadwal yang berjalan pada hari itu. Idempoten (indeks unik). */
  private async materialize(tx: TenantTx, orders: OrderRow[], day: string): Promise<void> {
    const rows = orders.flatMap((o) => {
      if (!scheduled(o.frequency)) return [];
      const stop = stopAt(o);
      return emarScheduleForDay(day, emarScheduleTimes(o.frequency as MedicationFrequency, o.customTimes), o.createdAt)
        .filter((at) => !stop || at < stop)
        .map((scheduledAt) => ({
          id: newId(),
          tenantId: this.db.tenantId(),
          medicationRequestId: o.id,
          encounterId: o.encounterId,
          scheduledAt,
        }));
    });
    if (rows.length > 0) await tx.medicationSchedule.createMany({ data: rows, skipDuplicates: true });
  }

  /**
   * Pemeriksa kedua: pengguna lain yang aktif dengan penugasan perawat/bidan yang berlaku. Sesi pemeriksa kedua tidak
   * diautentikasi ulang di fase 3 (dicatat namanya di pemberian + audit).
   */
  private async assertDoubleChecker(tx: TenantTx, checkerId: string, userId: string, now: Date): Promise<void> {
    if (checkerId === userId) {
      throw new AppError('VALIDATION_FAILED', 'Cek ganda harus oleh perawat lain', 422);
    }
    const ok = await tx.staffAssignment.findFirst({
      where: {
        userId: checkerId,
        user: { status: 'active' },
        role: { code: { in: DOUBLE_CHECK_ROLES } },
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { id: true },
    });
    if (!ok) throw new AppError('VALIDATION_FAILED', 'Pemeriksa kedua bukan perawat/bidan aktif RS ini', 422);
  }

  private async doubleCheckers(tx: TenantTx, unitId: string): Promise<EmarApi['doubleCheckers']> {
    const now = new Date();
    const self = this.db.actorUserId();
    const rows = await tx.staffAssignment.findMany({
      where: {
        unitId,
        user: { status: 'active' },
        role: { code: { in: DOUBLE_CHECK_ROLES } },
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        ...(self ? { NOT: { userId: self } } : {}),
      },
      select: { user: { select: { id: true, displayName: true } } },
    });
    const seen = new Map(rows.map((r) => [r.user.id, r.user.displayName]));
    return [...seen].map(([userId, nama]) => ({ userId, nama })).sort((a, b) => a.nama.localeCompare(b.nama));
  }

  private present(
    a: {
      id: string;
      medicationRequestId: string;
      scheduleId: string | null;
      status: string;
      occurredAt: Date;
      recordedAt: Date;
      late: boolean;
      reason: string | null;
      userId: string;
      userRole: string;
      doubleCheckUserId: string | null;
    },
    names: Map<string, string>,
    method: string,
  ): MedicationAdministrationRecord {
    return {
      id: a.id,
      medicationRequestId: a.medicationRequestId,
      scheduleId: a.scheduleId,
      status: a.status as MedicationAdministrationRecord['status'],
      occurredAt: a.occurredAt.toISOString(),
      recordedAt: a.recordedAt.toISOString(),
      late: a.late,
      reason: a.reason,
      by: { userId: a.userId, nama: names.get(a.userId) ?? 'Pengguna', peran: a.userRole },
      doubleCheckedBy: a.doubleCheckUserId
        ? { userId: a.doubleCheckUserId, nama: names.get(a.doubleCheckUserId) ?? 'Pengguna', peran: 'perawat' }
        : null,
      identification: method === 'dua_identitas' ? 'dua_identitas' : 'scan',
    };
  }
}
