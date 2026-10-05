import { Injectable } from '@nestjs/common';
import { readTenantSetting, toDbDate } from '@simrs/db';
import type { IdentifierSystem, KioskIdMethod, KioskPurpose } from '@simrs/shared';
import { newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const patientSelect = {
  id: true,
  name: true,
  birthDate: true,
  status: true,
  unidentified: true,
  mergedInto: { select: { id: true, name: true, birthDate: true, status: true, unidentified: true } },
} as const;

export interface KioskPatient {
  id: string;
  name: string;
  birthDate: Date | null;
  status: string;
  unidentified: boolean;
}

export interface LookupRow {
  id: string;
  deviceId: string;
  found: boolean;
  patientId: string | null;
  appointmentId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  idempotencyKey: string | null;
  ticketId: string | null;
}

/** F05 · Akses data anjungan (selalu transaksi bertenant permintaan perangkat). */
@Injectable()
export class KioskRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Kunci per perangkat sampai transaksi selesai: hitung-lalu-sisip batas laju tidak bisa diselip permintaan paralel
   * dari perangkat yang sama.
   */
  async lockDevice(deviceId: string): Promise<void> {
    await this.db.tx().$executeRaw`SELECT pg_advisory_xact_lock(hashtext('kiosk:' || ${deviceId}))`;
  }

  lookupRatePerMinute(): Promise<number> {
    return readTenantSetting(this.db.tx(), 'kiosk.lookup_rate_per_min');
  }

  avgServiceMinutes(): Promise<number> {
    return readTenantSetting(this.db.tx(), 'queue.avg_service_minutes');
  }

  countLookupsSince(deviceId: string, since: Date): Promise<number> {
    return this.db.tx().kioskLookup.count({ where: { deviceId, createdAt: { gte: since } } });
  }

  /** Pasien pemegang identifier aktif (hash semua kunci di cincin), rekam medis tergabung dialihkan ke tujuannya. */
  async patientsByIdentifier(system: IdentifierSystem, valueHashes: string[]): Promise<KioskPatient[]> {
    const rows = await this.db.tx().patientIdentifier.findMany({
      where: { system, valueHash: { in: valueHashes }, active: true },
      select: { patient: { select: patientSelect } },
      take: 5,
    });
    return rows.map((r) => resolveMerged(r.patient));
  }

  /** Booking hari ini (dipesan/sudah check-in) berdasarkan kode booking, beserta pasiennya. */
  async appointmentByCode(bookingCode: string, serviceDate: string) {
    const row = await this.db.tx().appointment.findFirst({
      where: {
        bookingCode,
        appointmentDate: toDbDate(serviceDate),
        status: { in: ['booked', 'checked_in'] },
      },
      select: { id: true, patient: { select: patientSelect } },
    });
    return row ? { id: row.id, patient: resolveMerged(row.patient) } : null;
  }

  /** Booking pasien hari ini: yang belum check-in didahulukan, lalu jam perkiraan. */
  appointmentToday(patientId: string, serviceDate: string) {
    return this.db.tx().appointment.findFirst({
      where: { patientId, appointmentDate: toDbDate(serviceDate), status: { in: ['booked', 'checked_in'] } },
      orderBy: [{ status: 'asc' }, { estimatedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
  }

  appointment(id: string) {
    return this.db.tx().appointment.findUnique({
      where: { id },
      select: { id: true, status: true, bookingCode: true, patientId: true },
    });
  }

  /** Tiket loket pendaftaran yang sudah terbit untuk booking ini (check-in sebelumnya di loket/anjungan). */
  counterTicketOf(appointmentId: string) {
    return this.db.tx().queueTicket.findFirst({
      where: { appointmentId, service: { kind: 'loket' }, status: { not: 'cancelled' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  async insertLookup(input: {
    deviceId: string;
    purpose: KioskPurpose;
    method: KioskIdMethod;
    tokenHash: string | null;
    patientId: string | null;
    appointmentId: string | null;
    expiresAt: Date;
  }): Promise<string> {
    const id = newId();
    await this.db.tx().kioskLookup.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        deviceId: input.deviceId,
        purpose: input.purpose,
        method: input.method,
        found: input.tokenHash !== null,
        tokenHash: input.tokenHash,
        patientId: input.patientId,
        appointmentId: input.appointmentId,
        expiresAt: input.expiresAt,
      },
    });
    return id;
  }

  /** Baris pencarian untuk token ini, dikunci (dua sentuhan bersamaan dengan token yang sama → berurutan). */
  async lockLookupByTokenHash(tokenHash: string): Promise<LookupRow | null> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM kiosk_lookups WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const id = rows[0]?.id;
    if (!id) return null;
    return this.db.tx().kioskLookup.findUnique({
      where: { id },
      select: {
        id: true,
        deviceId: true,
        found: true,
        patientId: true,
        appointmentId: true,
        expiresAt: true,
        usedAt: true,
        idempotencyKey: true,
        ticketId: true,
      },
    });
  }

  markLookupUsed(id: string, idempotencyKey: string | null, ticketId: string) {
    return this.db.tx().kioskLookup.update({
      where: { id },
      data: { usedAt: new Date(), idempotencyKey, ticketId },
      select: { id: true },
    });
  }

  /** Catat tiket untuk perangkat ini (boleh dicetak ulang olehnya); sudah tercatat → tidak apa-apa. */
  recordTicket(deviceId: string, ticketId: string) {
    return this.db.tx().kioskTicket.createMany({
      data: [{ id: newId(), tenantId: this.db.tenantId(), deviceId, ticketId }],
      skipDuplicates: true,
    });
  }

  countTicketsSince(deviceId: string, since: Date): Promise<number> {
    return this.db.tx().kioskTicket.count({ where: { deviceId, createdAt: { gte: since } } });
  }

  /** Waktu "panggil petugas" terakhir perangkat ini sejak `since` (jeda antarpanggilan), atau null. */
  async lastAssistSince(link: string, since: Date): Promise<Date | null> {
    const row = await this.db.tx().notification.findFirst({
      where: { kind: 'kiosk_assist', link, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  /** Tiket ini tercatat untuk perangkat ini sejak `since` (cetak ulang hanya di hari yang sama). */
  async deviceHasTicket(deviceId: string, ticketId: string, since: Date): Promise<boolean> {
    const n = await this.db
      .tx()
      .kioskTicket.count({ where: { deviceId, ticketId, createdAt: { gte: since } } });
    return n > 0;
  }

  /** No. SEP terbit terbaru kunjungan (ikut tercetak di tiket poli); null selama SEP masih `pending`. */
  async issuedSepNo(encounterId: string): Promise<string | null> {
    const row = await this.db.tx().sep.findFirst({
      where: { encounterId, status: 'issued', sepNo: { not: null } },
      orderBy: { version: 'desc' },
      select: { sepNo: true },
    });
    return row?.sepNo ?? null;
  }

  /** Rujukan/surat kontrol tercatat (hasil lookup VClaim sebelumnya) dasar SEP booking JKN: diagnosa awal. */
  referral(kind: string, number: string) {
    return this.db.tx().referral.findFirst({
      where: { kind, number },
      select: { patientId: true, status: true, diagnosisCode: true, diagnosisDisplay: true },
    });
  }

  /** Booking untuk registrasi anjungan: sesi, keranjang kuota, dan dasar JKN. */
  appointmentForRegistration(id: string) {
    return this.db.tx().appointment.findUnique({
      where: { id },
      select: {
        id: true,
        patientId: true,
        sessionId: true,
        quotaBucket: true,
        jknVisitKind: true,
        referenceNumber: true,
      },
    });
  }

  async tenantName(): Promise<string> {
    const t = await this.db
      .tx()
      .tenant.findUnique({ where: { id: this.db.tenantId() }, select: { name: true } });
    return t?.name ?? 'Rumah sakit';
  }

  async deviceName(deviceId: string): Promise<string> {
    const d = await this.db
      .tx()
      .registeredDevice.findUnique({ where: { id: deviceId }, select: { name: true } });
    return d?.name ?? 'Anjungan';
  }

  /** Petugas pendaftaran aktif (penerima "panggil petugas"); unit anjungan didahulukan bila ada petugas di sana. */
  async registrars(unitId: string | null, now = new Date()): Promise<string[]> {
    const rows = await this.db.tx().staffAssignment.findMany({
      where: {
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        role: { code: 'petugas_pendaftaran', active: true },
        user: { status: 'active' },
      },
      select: { userId: true, unitId: true },
    });
    const local = unitId ? rows.filter((r) => r.unitId === unitId) : [];
    return [...new Set((local.length > 0 ? local : rows).map((r) => r.userId))];
  }
}

function resolveMerged(p: KioskPatient & { mergedInto: KioskPatient | null }): KioskPatient {
  const { mergedInto, ...self } = p;
  return p.status === 'merged' && mergedInto ? mergedInto : self;
}
