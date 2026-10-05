import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isoFromDbDate } from '@simrs/db';
import {
  AppError,
  BPJS_VISIT_KINDS,
  type BpjsVisitKind,
  type CoverageInput,
  frontOfficeError,
  idempotencyKeySchema,
  isoDateJakarta,
  KIOSK_LOOKUP_TTL_SECONDS,
  type KioskCounterReason,
  type KioskIdentifyInput,
  type KioskIdentifyResult,
  kioskBirthDayMonth,
  kioskBirthDdmm,
  type KioskRegisterInput,
  type KioskSessionOption,
  type KioskTicketRequest,
  maskNameForKiosk,
  normalizeIdentifier,
  type PrintableTicket,
  printableTicketSchema,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { AuditedDenial } from '../../common/audited-denial';
import { API_ENV, type ApiEnv } from '../../config/env';
import { TenantDb } from '../../infra/tenant-db';
import { BookingService } from '../booking/booking.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';
import { RegistrationService } from '../registration/registration.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { type KioskPatient, KioskRepository, type LookupRow } from './kiosk.repository';

const MINUTE_MS = 60_000;
/**
 * Tiket loket tanpa identitas per perangkat per menit: nomor harian per layanan terbatas (999), jadi satu anjungan
 * tidak boleh menghabiskannya (temuan review keamanan potongan 9). Tiket dengan token sudah dibatasi pencarian.
 */
const ANONYMOUS_TICKETS_PER_MINUTE = 6;
/** Jeda minimum antar "panggil petugas" dari satu anjungan: panggilan ulang dalam jeda tidak mengirim notifikasi baru. */
const ASSIST_COOLDOWN_MS = 60_000;
/** `Idempotency-Key`: UUID atau kunci acak klien (huruf, angka, `-_:.`). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,100}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Token pencarian `kl1.` + 256 bit base64url (43 karakter). */
const newLookupToken = () => `kl1.${randomBytes(32).toString('base64url')}`;

/** Jalan ke loket (422 `KIOSK_NEEDS_COUNTER`): anjungan menawarkan tiket loket tanpa identitas. */
const needsCounter = (reason: KioskCounterReason) =>
  frontOfficeError('KIOSK_NEEDS_COUNTER', { reason, ticket: null });

/** Sesi anjungan berakhir (token tidak ada/kedaluwarsa/terpakai). Sama untuk semua sebab: tidak membocorkan apa pun. */
const lookupExpired = () => frontOfficeError('KIOSK_LOOKUP_EXPIRED');

/**
 * F05 · Anjungan mandiri (prinsipal perangkat `kiosk.use`, ADR-0027; keputusan fase 2 no. 3).
 *
 * - `identify`: NIK / kartu BPJS / kode booking + tanggal dan bulan lahir (DDMM) → nama tersamar + tanggal lahir tanpa
 *   tahun + token `kl1` berumur `KIOSK_LOOKUP_TTL_SECONDS`. Jawaban seragam (200 ditemukan/tidak; DDMM salah = tidak
 *   ditemukan), dibatasi `kiosk.lookup_rate_per_min` per perangkat dan `kiosk.lookup_rate_per_tenant_per_min` per RS
 *   (429 tercatat), setiap percobaan diaudit atas nama perangkat.
 * - `checkIn` / `issueTicket`: menukar token SEKALI PAKAI di perangkat yang sama; `Idempotency-Key` yang sama →
 *   tiket yang sama (sentuhan ganda tidak mencetak dua nomor).
 * - `print`: hanya tiket yang tercatat untuk perangkat ini hari ini (`kiosk_tickets`).
 * Anjungan tidak pernah menerima ID pasien, RM, atau NIK.
 *
 * - `register`: registrasi mandiri rawat jalan memakai ulang `RegistrationService.registerOutpatient` (potongan 5a:
 *   Idempotency-Key, kunjungan, penjaminan, SEP `pending` lewat outbox, event `encounter.registered` → task 3) atas
 *   nama perangkat; yang butuh petugas (persetujuan umum belum ada, rujukan belum tercatat, kuota penuh) → 422
 *   `KIOSK_NEEDS_COUNTER` dengan alasan `KIOSK_COUNTER_REASONS`.
 */
@Injectable()
export class KioskService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly repo: KioskRepository,
    private readonly db: TenantDb,
    private readonly booking: BookingService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly registration: RegistrationService,
    private readonly scheduling: SchedulingService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Identifikasi
  // ------------------------------------------------------------------------------------------------------------

  async identify(input: KioskIdentifyInput, now = new Date()): Promise<KioskIdentifyResult> {
    const deviceId = this.deviceId();
    await this.repo.lockTenantLookups();
    const since = new Date(now.getTime() - MINUTE_MS);
    const [limit, tenantLimit, recent, tenantRecent] = await Promise.all([
      this.repo.lookupRatePerMinute(),
      this.repo.lookupRatePerTenantPerMinute(),
      this.repo.countLookupsSince(deviceId, since),
      this.repo.countTenantLookupsSince(since),
    ]);
    const exceeded =
      recent >= limit
        ? { reason: 'rate_limited', limit }
        : tenantRecent >= tenantLimit
          ? { reason: 'tenant_rate_limited', limit: tenantLimit }
          : null;
    if (exceeded) {
      throw new AuditedDenial(
        'Terlalu banyak pencarian di anjungan. Tunggu sebentar atau minta bantuan petugas.',
        { resourceType: 'kiosk_lookup', details: { ...exceeded, method: input.method } },
        { retryAfterSeconds: 60 },
        { code: 'RATE_LIMITED', status: 429 },
      );
    }

    const today = isoDateJakarta(now);
    const candidate = await this.match(input, today);
    // Faktor kedua: tanggal + bulan lahir (DDMM). Salah = jawaban sama persis dengan "tidak ditemukan"; percobaannya
    // tetap dihitung batas laju dan dicatat audit dengan pasiennya (bahan tinjauan petugas privasi).
    const birthOk = candidate ? sameDdmm(candidate.patient.birthDate as Date, input.birthDdmm) : false;
    const match = birthOk ? candidate : null;
    const token = match ? newLookupToken() : null;
    const expiresAt = new Date(now.getTime() + KIOSK_LOOKUP_TTL_SECONDS * 1000);
    const lookupId = await this.repo.insertLookup({
      deviceId,
      purpose: input.purpose,
      method: input.method,
      tokenHash: token ? sha256(token) : null,
      patientId: match?.patient.id ?? null,
      appointmentId: match?.appointmentId ?? null,
      expiresAt,
    });
    // Nilai yang diketik tidak dicatat (NIK/kartu/kode); cukup cara, tujuan, dan hasil.
    this.db.audit({
      action: 'search',
      resourceType: 'kiosk_lookup',
      resourceId: lookupId,
      patientId: candidate?.patient.id ?? null,
      details: {
        method: input.method,
        purpose: input.purpose,
        found: match !== null,
        ...(candidate && !birthOk ? { birthMismatch: true } : {}),
      },
    });
    if (!match || !token) return { found: false };
    return {
      found: true,
      lookupToken: token,
      expiresAt: expiresAt.toISOString(),
      nameMasked: maskNameForKiosk(match.patient.name),
      birthDayMonth: kioskBirthDayMonth(isoFromDbDate(match.patient.birthDate as Date)),
      hasBookingToday: match.appointmentId !== null,
    };
  }

  /**
   * Pasien tunggal yang cocok (identitas lengkap: bukan tanpa-identitas, ada tanggal lahir untuk konfirmasi), atau
   * null. NIK/kartu ganda di lebih dari satu rekam medis → tidak ditemukan (diselesaikan petugas di loket).
   */
  private async match(
    input: KioskIdentifyInput,
    today: string,
  ): Promise<{ patient: KioskPatient; appointmentId: string | null } | null> {
    if (input.method === 'booking') {
      const appt = await this.repo.appointmentByCode(input.value, today);
      if (!appt || !usable(appt.patient)) return null;
      return { patient: appt.patient, appointmentId: appt.id };
    }
    const crypto = new PatientCrypto(this.env.fieldKeys, this.db.tenantId());
    const hashes = crypto.identifierHashes(input.method, normalizeIdentifier(input.value));
    const found = await this.repo.patientsByIdentifier(input.method, hashes);
    const ids = new Set(found.map((p) => p.id));
    const patient = found[0];
    if (ids.size !== 1 || !patient || !usable(patient)) return null;
    const appt = await this.repo.appointmentToday(patient.id, today);
    return { patient, appointmentId: appt?.id ?? null };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Check-in dan tiket
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Check-in booking hari ini (task 1 lewat event `booking.checked_in`) + tiket loket pendaftaran bersumber
   * `anjungan` untuk semua penjamin (SEP/registrasi menyusul di loket). Booking yang sudah check-in → tiket loketnya
   * dicetak ulang. Tanpa booking hari ini → 422 `KIOSK_NEEDS_COUNTER` (`bukan_hari_layanan`).
   */
  async checkIn(lookupToken: string, idempotencyKey: string | undefined): Promise<PrintableTicket> {
    const key = requireIdempotencyKey(idempotencyKey);
    const claim = await this.claim(lookupToken, key);
    if (claim.lookup === null) return this.printable(claim.replayTicketId);
    const lookup = claim.lookup;
    const patientId = lookup.patientId as string;
    if (!lookup.appointmentId) throw needsCounter('bukan_hari_layanan');
    const appt = await this.repo.appointment(lookup.appointmentId);
    if (!appt || appt.patientId !== patientId) throw needsCounter('bukan_hari_layanan');

    let ticketId: string;
    if (appt.status === 'booked') {
      const result = await this.booking.checkIn(appt.id, { source: 'anjungan', counterTicket: 'always' });
      if (!result.counterTicket) throw needsCounter('data_belum_lengkap');
      ticketId = result.counterTicket.id;
      this.db.audit({
        action: 'update',
        resourceType: 'appointment',
        resourceId: appt.id,
        patientId,
        details: { status: 'checked_in', channel: 'anjungan' },
      });
    } else if (appt.status === 'checked_in') {
      const existing = await this.repo.counterTicketOf(appt.id);
      if (!existing) throw needsCounter('data_belum_lengkap');
      ticketId = existing.id;
    } else {
      throw needsCounter('bukan_hari_layanan');
    }
    await this.complete(lookup, key, ticketId);
    return this.printable(ticketId);
  }

  /**
   * Tiket loket pendaftaran (tanpa identitas), atau farmasi/kasir (setelah identifikasi; tiket menunggu milik pasien
   * yang sama dipakai ulang).
   */
  async issueTicket(input: KioskTicketRequest, idempotencyKey: string | undefined): Promise<PrintableTicket> {
    const key = idempotencyKey === undefined ? null : requireIdempotencyKey(idempotencyKey);
    let lookup: LookupRow | null = null;
    if (input.lookupToken) {
      const claim = await this.claim(input.lookupToken, key);
      if (claim.lookup === null) return this.printable(claim.replayTicketId);
      lookup = claim.lookup;
    }
    if (!lookup) await this.assertTicketRate();
    const { ticket } = await this.queue.issueKioskTicket(input.serviceKind, {
      patientId: lookup?.patientId ?? null,
      appointmentId: input.serviceKind === 'loket' ? (lookup?.appointmentId ?? null) : null,
    });
    if (lookup) await this.complete(lookup, key, ticket.id);
    else await this.repo.recordTicket(this.deviceId(), ticket.id);
    return this.printable(ticket.id);
  }

  /** Cetak (ulang) tiket: hanya tiket yang tercatat untuk perangkat ini hari ini; selain itu 404 tercatat. */
  async print(
    ticketId: string,
    now = new Date(),
  ): Promise<{ ticket: PrintableTicket; patientId: string | null }> {
    const since = new Date(`${isoDateJakarta(now)}T00:00:00+07:00`);
    if (!(await this.repo.deviceHasTicket(this.deviceId(), ticketId, since))) {
      throw new AuditedDenial(
        'Tiket tidak ditemukan',
        { resourceType: 'queue_ticket', resourceId: ticketId, details: { reason: 'not_issued_by_device' } },
        undefined,
        { code: 'NOT_FOUND', status: 404 },
      );
    }
    const { ticket, patientId } = await this.printableWithPatient(ticketId);
    this.db.audit({
      action: 'print',
      resourceType: 'queue_ticket',
      resourceId: ticketId,
      patientId,
      details: { queueNo: ticket.queueNo },
    });
    return { ticket, patientId };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Registrasi mandiri (alur potongan 5a)
  // ------------------------------------------------------------------------------------------------------------

  /** Sesi dokter hari ini untuk pasien umum (informasi publik; `available` = sisa kuota non-JKN). */
  async sessions(): Promise<KioskSessionOption[]> {
    const quotas = await this.scheduling.todayQuotas({});
    return quotas.map((q) => ({
      sessionId: q.sessionId,
      poliName: q.poliName,
      practitionerName: q.doctorName,
      start: q.start.replace('.', ':'),
      end: q.end.replace('.', ':'),
      available: q.nonJkn.booked < q.nonJkn.total,
    }));
  }

  /**
   * Registrasi rawat jalan dari anjungan → tiket poli (+ no. SEP bila sudah terbit). BPJS: booking JKN hari ini
   * dengan rujukan/surat kontrol yang sudah tercatat (diagnosa awal dari rujukan itu); umum: sesi pilihan pasien.
   * Persetujuan umum harus sudah ada (penandatanganan disaksikan petugas, tidak di anjungan). Header
   * `Idempotency-Key` (UUID) dipakai untuk token anjungan dan untuk registrasi 5a sekaligus.
   */
  async register(input: KioskRegisterInput, idempotencyKey: string | undefined): Promise<PrintableTicket> {
    const parsedKey = idempotencyKeySchema.safeParse(idempotencyKey?.trim().toLowerCase());
    if (!parsedKey.success) throw frontOfficeError('IDEMPOTENCY_KEY_REQUIRED');
    const key = parsedKey.data;
    const claim = await this.claim(input.lookupToken, key);
    if (claim.lookup === null) return this.printable(claim.replayTicketId);
    const lookup = claim.lookup;
    const patientId = lookup.patientId as string;

    let registration: { sessionId: string; appointmentId?: string; coverage: CoverageInput };
    if (input.payer === 'bpjs') {
      const appt = lookup.appointmentId
        ? await this.repo.appointmentForRegistration(lookup.appointmentId)
        : null;
      if (!appt || appt.patientId !== patientId) throw needsCounter('bukan_hari_layanan');
      const visitKind = (Object.keys(BPJS_VISIT_KINDS) as BpjsVisitKind[]).find(
        (k) => BPJS_VISIT_KINDS[k].code === appt.jknVisitKind,
      );
      if (appt.quotaBucket !== 'jkn' || !visitKind || !appt.referenceNumber) {
        throw needsCounter('data_belum_lengkap');
      }
      const ref = await this.repo.referral(BPJS_VISIT_KINDS[visitKind].referralKind, appt.referenceNumber);
      if (!ref || ref.patientId !== patientId || !ref.diagnosisCode || !ref.diagnosisDisplay) {
        throw needsCounter('rujukan_tidak_berlaku');
      }
      registration = {
        sessionId: appt.sessionId,
        appointmentId: appt.id,
        coverage: {
          payer: 'bpjs',
          visitKind,
          referenceNumber: appt.referenceNumber,
          initialDiagnosis: { code: ref.diagnosisCode, display: ref.diagnosisDisplay },
        },
      };
    } else {
      registration = { sessionId: input.sessionId, coverage: { payer: 'umum' } };
    }

    let ticketId: string | null;
    try {
      const result = await this.registration.registerOutpatient({ patientId, ...registration }, key);
      ticketId = result.queueTicket?.id ?? null;
    } catch (err) {
      throw asCounterError(err);
    }
    if (!ticketId) throw needsCounter('data_belum_lengkap');
    await this.complete(lookup, key, ticketId);
    return this.printable(ticketId);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Bantuan
  // ------------------------------------------------------------------------------------------------------------

  /** "Panggil petugas" (P09): notifikasi in-app ke petugas pendaftaran, tanpa PHI (hanya nama perangkat). */
  async assist(now = new Date()): Promise<{ requestedAt: string }> {
    const deviceId = this.deviceId();
    await this.repo.lockDevice(deviceId);
    // Satu panggilan per jeda: sentuhan berulang tidak membanjiri notifikasi petugas.
    const link = `/antrean?perangkat=${deviceId}`;
    const last = await this.repo.lastAssistSince(link, new Date(now.getTime() - ASSIST_COOLDOWN_MS));
    if (last) {
      this.db.audit({
        action: 'create',
        resourceType: 'kiosk_assist',
        details: { notified: 0, repeated: true },
      });
      return { requestedAt: last.toISOString() };
    }
    const [name, recipients] = await Promise.all([
      this.repo.deviceName(deviceId),
      this.repo.registrars(this.db.actor().unitId),
    ]);
    const notified = await this.notifications.notify(
      recipients,
      {
        kind: 'kiosk_assist',
        title: 'Anjungan meminta bantuan',
        body: `Pengunjung di ${name} membutuhkan bantuan petugas.`,
        link,
      },
      ['in_app'],
    );
    this.db.audit({ action: 'create', resourceType: 'kiosk_assist', details: { notified } });
    return { requestedAt: now.toISOString() };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Bantuan internal
  // ------------------------------------------------------------------------------------------------------------

  /** Batas tiket loket tanpa identitas per perangkat (hitung-lalu-terbit di bawah kunci perangkat). */
  private async assertTicketRate(now = new Date()): Promise<void> {
    const deviceId = this.deviceId();
    await this.repo.lockDevice(deviceId);
    const recent = await this.repo.countTicketsSince(deviceId, new Date(now.getTime() - MINUTE_MS));
    if (recent >= ANONYMOUS_TICKETS_PER_MINUTE) {
      throw new AuditedDenial(
        'Terlalu banyak tiket dari anjungan ini. Tunggu sebentar atau minta bantuan petugas.',
        {
          resourceType: 'kiosk_ticket',
          details: { reason: 'rate_limited', limit: ANONYMOUS_TICKETS_PER_MINUTE },
        },
        { retryAfterSeconds: 60 },
        { code: 'RATE_LIMITED', status: 429 },
      );
    }
  }

  private deviceId(): string {
    const principal = this.db.actor().devicePrincipal;
    if (!principal || principal.kind !== 'kiosk') {
      throw frontOfficeError('DEVICE_NOT_ALLOWED');
    }
    return principal.id;
  }

  /**
   * Tukar token pencarian (sekali pakai, perangkat yang sama, belum kedaluwarsa). Token yang sudah dipakai dengan
   * `Idempotency-Key` yang sama → tiket sebelumnya (`replayTicketId`). Token perangkat lain → 410 yang sama, tercatat.
   * Titik masuk registrasi anjungan setelah potongan 5a.
   */
  private async claim(
    token: string,
    key: string | null,
    now = new Date(),
  ): Promise<{ lookup: LookupRow; replayTicketId: null } | { lookup: null; replayTicketId: string }> {
    const lookup = await this.repo.lockLookupByTokenHash(sha256(token));
    if (!lookup?.found) throw lookupExpired();
    if (lookup.deviceId !== this.deviceId()) {
      const def = frontOfficeError('KIOSK_LOOKUP_EXPIRED');
      throw new AuditedDenial(
        def.message,
        { resourceType: 'kiosk_lookup', resourceId: lookup.id, details: { reason: 'other_device' } },
        undefined,
        { code: 'KIOSK_LOOKUP_EXPIRED', status: def.status },
      );
    }
    if (lookup.usedAt) {
      if (key !== null && lookup.idempotencyKey === key && lookup.ticketId) {
        return { lookup: null, replayTicketId: lookup.ticketId };
      }
      throw lookupExpired();
    }
    if (lookup.expiresAt.getTime() <= now.getTime()) throw lookupExpired();
    return { lookup, replayTicketId: null };
  }

  private async complete(lookup: LookupRow, key: string | null, ticketId: string): Promise<void> {
    await this.repo.markLookupUsed(lookup.id, key, ticketId);
    await this.repo.recordTicket(lookup.deviceId, ticketId);
  }

  private async printable(ticketId: string): Promise<PrintableTicket> {
    return (await this.printableWithPatient(ticketId)).ticket;
  }

  private async printableWithPatient(
    ticketId: string,
  ): Promise<{ ticket: PrintableTicket; patientId: string | null }> {
    const [{ ticket, service, ahead }, tenantName, avg] = await Promise.all([
      this.queue.ticketForPrint(ticketId),
      this.repo.tenantName(),
      this.repo.avgServiceMinutes(),
    ]);
    const [appt, sepNo] = await Promise.all([
      ticket.appointmentId ? this.repo.appointment(ticket.appointmentId) : null,
      ticket.encounterId ? this.repo.issuedSepNo(ticket.encounterId) : null,
    ]);
    const location = [service.floor !== null ? `Lantai ${service.floor}` : null, service.room]
      .filter((x): x is string => !!x)
      .join(' · ');
    const printable = printableTicketSchema.parse({
      ticketId: ticket.id,
      tenantName: tenantName.slice(0, 160),
      queueNo: ticket.queueNo,
      destination: service.name.slice(0, 120),
      location: (location || service.name).slice(0, 120),
      issuedAt: ticket.issuedAt,
      estimatedWaitMinutes: ticket.status === 'waiting' ? ahead * avg : null,
      sepNo,
      bookingCode: appt?.bookingCode ?? null,
    });
    return { ticket: printable, patientId: ticket.patientId };
  }
}

/**
 * Galat registrasi 5a yang berarti "petugas perlu membantu" → 422 `KIOSK_NEEDS_COUNTER` (alasan tetap, tanpa rincian
 * internal). Galat lain (mis. idempotensi, perangkat) diteruskan apa adanya.
 */
const COUNTER_ERRORS: Partial<Record<string, KioskCounterReason>> = {
  GENERAL_CONSENT_REQUIRED: 'data_belum_lengkap',
  VALIDATION_FAILED: 'data_belum_lengkap',
  NOT_FOUND: 'data_belum_lengkap',
  CONFLICT: 'data_belum_lengkap',
  ENCOUNTER_DUPLICATE: 'data_belum_lengkap',
  BOOKING_NOT_FOUND: 'bukan_hari_layanan',
  BOOKING_STATE_INVALID: 'bukan_hari_layanan',
  BOOKING_DUPLICATE: 'bukan_hari_layanan',
  SESSION_CLOSED: 'bukan_hari_layanan',
  QUOTA_FULL: 'kuota_penuh',
  REFERRAL_EXPIRED: 'rujukan_tidak_berlaku',
  REFERRAL_STATE_INVALID: 'rujukan_tidak_berlaku',
};

function asCounterError(err: unknown): unknown {
  if (err instanceof AppError) {
    const reason = COUNTER_ERRORS[err.code];
    if (reason) return needsCounter(reason);
  }
  return err;
}

/** Tanggal + bulan lahir rekam medis sama dengan yang diketik (perbandingan waktu-konstan). */
function sameDdmm(birthDate: Date, typed: string): boolean {
  const expected = Buffer.from(kioskBirthDdmm(isoFromDbDate(birthDate)));
  const given = Buffer.from(typed);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Rekam medis yang bisa dikonfirmasi pemiliknya di anjungan. */
function usable(p: KioskPatient): boolean {
  return p.status === 'active' && !p.unidentified && p.birthDate !== null;
}

function requireIdempotencyKey(key: string | undefined): string {
  if (!key) throw frontOfficeError('IDEMPOTENCY_KEY_REQUIRED');
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new AppError('VALIDATION_FAILED', 'Header Idempotency-Key tidak valid', 400);
  }
  return key;
}
