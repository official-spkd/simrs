import { Injectable } from '@nestjs/common';
import {
  allocateNumber,
  enqueueOutbox,
  readTenantSetting,
  dbDateFromIso,
  hhmmFromDbTime,
  isoFromDbDate,
} from '@simrs/db';
import {
  AppError,
  BPJS_ANTREAN_ADD_OPERATION,
  BPJS_ANTREAN_BATAL_OPERATION,
  BPJS_REJECTIONS,
  BPJS_VISIT_KINDS,
  type Booking,
  type BookingListQuery,
  type BpjsSyncStatus,
  type BpjsVisitKind,
  type CancelBookingInput,
  type CheckInResult,
  type CreateBookingInput,
  frontOfficeError,
  isoDateJakarta,
  jakartaWallTime,
  outboxKey,
  type QueueTicket,
  type RescheduleBookingInput,
  newId,
} from '@simrs/shared';
import { toPage } from '../../common/pagination';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { type AppointmentRow, BookingRepository, type TicketRow } from './booking.repository';

const DAY_MS = 86_400_000;
/** Kode galat status kirim BPJS yang bukan penolakan bisnis (pesan dari sini, bukan dari BPJS). */
const SYNC_ERRORS: Record<string, string> = {
  BPJS_TIDAK_DIKENAL: 'Ditolak BPJS (alasan belum dipetakan)',
  BPJS_DLQ: 'Gagal dikirim ke BPJS sampai batas waktu; perlu dikirim ulang',
};

/** Tanggal kalender `YYYY-MM-DD` + jam dinding WIB `HH:MM` → instan. */
const wibInstant = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return jakartaWallTime(y, m, d, hh, mm);
};

const visitKindByCode = (code: number): BpjsVisitKind | undefined =>
  (Object.entries(BPJS_VISIT_KINDS) as Array<[BpjsVisitKind, { code: number }]>).find(
    ([, v]) => v.code === code,
  )?.[0];

const invalidState = (message: string) => frontOfficeError('BOOKING_STATE_INVALID', undefined, message);
const notFound = () => frontOfficeError('BOOKING_NOT_FOUND');

/**
 * F02 · Booking: pesan kuota sesi secara atomik (`reserveQuota`), kode booking harian (P08 `booking_code`), nomor
 * antrean poli dicadangkan + estimasi, Antrean BPJS lewat outbox (JKN), batal/jadwal ulang/check-in. Check-in dan
 * batal menerbitkan event domain (`booking.checked_in`, `booking.cancelled`) di transaksi yang sama; task ID BPJS
 * dibentuk modul antrean dari event itu, bukan di sini.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly repo: BookingRepository,
    private readonly db: TenantDb,
    private readonly events: DomainEvents,
  ) {}

  // -----------------------------------------------------------------------------------------------------------------
  // Baca
  // -----------------------------------------------------------------------------------------------------------------

  async list(q: BookingListQuery) {
    const page = toPage(
      await this.repo.list({ ...q, serviceDate: q.serviceDate ? dbDateFromIso(q.serviceDate) : undefined }),
      q.limit,
    );
    for (const a of page.items) {
      // Setiap booking yang tampil = satu baca data pasien (seperti hasil cari MPI); filter tidak dicatat.
      this.db.audit({
        action: 'search',
        resourceType: 'appointment',
        resourceId: a.id,
        patientId: a.patientId,
      });
    }
    return { items: page.items.map((a) => this.toBooking(a)), nextCursor: page.nextCursor };
  }

  async get(id: string): Promise<Booking> {
    return this.toBooking(await this.load(id));
  }

  async getByCode(code: string): Promise<Booking> {
    const a = await this.repo.findByCode(code);
    if (!a) throw notFound();
    return this.toBooking(a);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Buat
  // -----------------------------------------------------------------------------------------------------------------

  async create(input: CreateBookingInput): Promise<Booking> {
    const id = await this.book({ ...input, channel: 'loket' });
    return this.get(id);
  }

  /**
   * F03 · Registrasi rawat jalan walk-in: booking kanal loket untuk sesi hari ini (kuota, nomor poli cadangan,
   * Antrean BPJS untuk JKN) di transaksi registrasi. Mengembalikan id booking.
   */
  createForVisit(input: CreateBookingInput): Promise<string> {
    return this.book({ ...input, channel: 'loket' });
  }

  /**
   * F03 · Pasien booking hadir di loket dan didaftarkan: `booked` → `checked_in` (hari layanan saja; booking yang
   * sudah check-in dibiarkan). `publishEvent` = terbitkan `booking.checked_in` (task 1 saat ini); false bila pasien
   * datang lewat tiket loket yang ditautkan ke booking (task 1–2 diisi mesin task ID dari tiket itu).
   */
  async markArrived(id: string, opts: { publishEvent: boolean }): Promise<void> {
    await this.repo.lock(id);
    const a = await this.load(id);
    if (a.status === 'checked_in') return;
    if (a.status !== 'booked') throw invalidState(`Booking berstatus ${a.status} tidak bisa didaftarkan`);
    if (isoFromDbDate(a.appointmentDate) !== isoDateJakarta(new Date())) {
      throw invalidState('Registrasi hanya pada hari layanan booking');
    }
    await this.repo.updateAppointment(id, { status: 'checked_in', checkedInAt: new Date() });
    if (opts.publishEvent) {
      await this.events.publish('booking.checked_in', { appointmentId: id, patientId: a.patientId });
    }
  }

  /** Inti buat booking (juga dipakai jadwal ulang). Mengembalikan id booking baru. */
  private async book(input: CreateBookingInput & { channel: 'loket' }): Promise<string> {
    const patient = await this.repo.findPatient(input.patientId);
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (patient.status !== 'active') {
      throw new AppError('CONFLICT', 'Rekam medis ini sudah digabung; pakai rekam medis tujuan', 409, {
        mergedInto: patient.mergedIntoId,
      });
    }
    if (input.quotaBucket === 'jkn') {
      const systems = new Set(patient.identifiers.map((i) => i.system));
      if (!systems.has('bpjs') || !systems.has('nik')) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Booking JKN butuh no. kartu BPJS dan NIK pasien yang aktif (Antrean BPJS)',
          422,
        );
      }
    }

    const session = await this.repo.findSession(input.sessionId);
    if (!session) throw new AppError('NOT_FOUND', 'Sesi praktik tidak ditemukan', 404);
    const serviceDate = isoFromDbDate(session.sessionDate);
    const today = isoDateJakarta(new Date());
    if (session.service.kind !== 'poli' || !session.service.active) {
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Layanan sesi ini bukan poli yang aktif');
    }
    if (serviceDate < today || (session.kind === 'cuti' && !session.substituteId)) {
      throw frontOfficeError('SESSION_CLOSED');
    }
    const maxDays = await readTenantSetting(this.db.tx(), 'booking.max_days_ahead');
    if (dbDateFromIso(serviceDate).getTime() - dbDateFromIso(today).getTime() > maxDays * DAY_MS) {
      throw frontOfficeError('BOOKING_OUT_OF_RANGE', { maxDaysAhead: maxDays });
    }
    if ((await this.repo.hasActiveBooking(input.patientId, session.serviceId, session.sessionDate)) > 0) {
      throw frontOfficeError('BOOKING_DUPLICATE');
    }

    const quota = await this.repo.reserve(session.id, input.quotaBucket);
    if (!quota) throw frontOfficeError('QUOTA_FULL');

    const code = await allocateNumber(
      this.db.tx(),
      this.db.tenantId(),
      'booking_code',
      wibInstant(serviceDate, '00:00'),
    );
    const ticketNo = await this.repo.allocateTicketNumber(session.serviceId, serviceDate);
    const avgMinutes = await readTenantSetting(this.db.tx(), 'queue.avg_service_minutes');
    const position = await this.sessionPosition(session.id);
    const estimatedAt = new Date(
      wibInstant(serviceDate, hhmmFromDbTime(session.startTime)).getTime() + position * avgMinutes * 60_000,
    );

    const id = newId();
    const jkn = input.quotaBucket === 'jkn' ? input.jkn : undefined;
    const created = await this.repo.createAppointment({
      id,
      bookingCode: code.number,
      patientId: input.patientId,
      sessionId: session.id,
      practitionerId: session.substituteId ?? session.practitionerId,
      serviceId: session.serviceId,
      appointmentDate: session.sessionDate,
      quotaBucket: input.quotaBucket,
      jknVisitKind: jkn ? BPJS_VISIT_KINDS[jkn.visitKind].code : null,
      referenceNumber: jkn?.referenceNumber ?? null,
      channel: input.channel,
      estimatedAt,
      bpjsSyncStatus: jkn ? 'pending' : 'not_required',
    });
    if (created === 'duplicate') throw frontOfficeError('BOOKING_DUPLICATE');
    await this.repo.createTicket({
      id: newId(),
      serviceId: session.serviceId,
      serviceDate: session.sessionDate,
      seq: ticketNo.seq,
      ticketNo: ticketNo.ticketNo,
      appointmentId: id,
      patientId: input.patientId,
      source: 'booking',
      reserved: true,
    });
    if (jkn) {
      await enqueueOutbox(this.db.tx(), this.db.tenantId(), {
        target: 'bpjs',
        operation: BPJS_ANTREAN_ADD_OPERATION,
        idempotencyKey: outboxKey(BPJS_ANTREAN_ADD_OPERATION, id),
        payload: { appointmentId: id },
      });
    }
    return id;
  }

  /** Urutan (0-based) booking terbaru di sesi ini = jumlah booking aktif sebelum booking ini. */
  private async sessionPosition(sessionId: string): Promise<number> {
    const [row] = await this.db.tx().$queryRaw<Array<{ n: number }>>`
      SELECT (booked_jkn + booked_non_jkn - 1)::int AS n FROM schedule_sessions WHERE id = ${sessionId}::uuid`;
    return Math.max(0, row?.n ?? 0);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Batal, jadwal ulang, check-in
  // -----------------------------------------------------------------------------------------------------------------

  async cancel(id: string, input: CancelBookingInput): Promise<Booking> {
    await this.cancelRow(id, input.reason);
    return this.get(id);
  }

  private async cancelRow(id: string, reason: string): Promise<AppointmentRow> {
    await this.repo.lock(id);
    const a = await this.load(id);
    if (a.status !== 'booked' && a.status !== 'checked_in') {
      throw invalidState(`Booking berstatus ${a.status} tidak bisa dibatalkan`);
    }
    await this.repo.release(a.sessionId, a.quotaBucket as 'jkn' | 'non_jkn');
    // Antrean BPJS dibatalkan bila booking sudah (atau mungkin sudah) terdaftar di BPJS.
    const sendBatal = a.bpjsSyncStatus === 'pending' || a.bpjsSyncStatus === 'sent';
    await this.repo.updateAppointment(id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: this.db.actorUserId(),
      cancelReason: reason,
      ...(sendBatal ? { bpjsCancelStatus: 'pending', bpjsCancelErrorCode: null } : {}),
    });
    await this.repo.cancelOpenTickets(id);
    if (sendBatal) {
      await enqueueOutbox(this.db.tx(), this.db.tenantId(), {
        target: 'bpjs',
        operation: BPJS_ANTREAN_BATAL_OPERATION,
        idempotencyKey: outboxKey(BPJS_ANTREAN_BATAL_OPERATION, id),
        payload: { appointmentId: id },
      });
    }
    await this.events.publish('booking.cancelled', { appointmentId: id, patientId: a.patientId });
    return a;
  }

  /** Jadwal ulang = booking lama dibatalkan (alasan dicatat, kuota dilepas) + booking baru di sesi lain, atomik. */
  async reschedule(
    id: string,
    input: RescheduleBookingInput,
  ): Promise<{ cancelled: Booking; booking: Booking }> {
    if ((await this.load(id)).sessionId === input.sessionId) {
      throw invalidState('Jadwal ulang harus ke sesi lain');
    }
    const old = await this.cancelRow(id, input.reason);
    const jknVisitKind = old.jknVisitKind === null ? undefined : visitKindByCode(old.jknVisitKind);
    const newId_ = await this.book(
      old.quotaBucket === 'jkn'
        ? {
            patientId: old.patientId,
            sessionId: input.sessionId,
            quotaBucket: 'jkn',
            jkn: { visitKind: jknVisitKind as BpjsVisitKind, referenceNumber: old.referenceNumber ?? '' },
            channel: 'loket',
          }
        : { patientId: old.patientId, sessionId: input.sessionId, quotaBucket: 'non_jkn', channel: 'loket' },
    );
    return { cancelled: await this.get(id), booking: await this.get(newId_) };
  }

  /** Check-in hari layanan: status `checked_in`, tiket loket pendaftaran (JKN), event `booking.checked_in`. */
  async checkIn(id: string): Promise<CheckInResult> {
    await this.repo.lock(id);
    const a = await this.load(id);
    if (a.status !== 'booked') throw invalidState(`Booking berstatus ${a.status} tidak bisa check-in`);
    const serviceDate = isoFromDbDate(a.appointmentDate);
    if (serviceDate !== isoDateJakarta(new Date())) {
      throw invalidState('Check-in hanya pada hari layanan');
    }
    await this.repo.updateAppointment(id, { status: 'checked_in', checkedInAt: new Date() });
    let counterTicketId: string | null = null;
    if (a.quotaBucket === 'jkn') {
      const counter = await this.repo.findCounterService();
      if (counter) {
        const n = await this.repo.allocateTicketNumber(counter.id, serviceDate);
        counterTicketId = (
          await this.repo.createTicket({
            id: newId(),
            serviceId: counter.id,
            serviceDate: a.appointmentDate,
            seq: n.seq,
            ticketNo: n.ticketNo,
            appointmentId: id,
            patientId: a.patientId,
            source: 'loket',
          })
        ).id;
      }
    }
    await this.events.publish('booking.checked_in', { appointmentId: id, patientId: a.patientId });
    const after = await this.load(id);
    const counterTicket = after.tickets.find((t) => t.id === counterTicketId);
    return { booking: this.toBooking(after), counterTicket: counterTicket ? toTicket(counterTicket) : null };
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Bentuk respons
  // -----------------------------------------------------------------------------------------------------------------

  private async load(id: string): Promise<AppointmentRow> {
    const a = await this.repo.findById(id);
    if (!a) throw notFound();
    return a;
  }

  private toBooking(a: AppointmentRow): Booking {
    const poliTicket = a.tickets.find((t) => t.serviceId === a.serviceId && t.reserved) ?? a.tickets[0];
    const jknKind = a.jknVisitKind === null ? undefined : visitKindByCode(a.jknVisitKind);
    const status = a.bpjsSyncStatus as BpjsSyncStatus;
    const errorCode = a.bpjsErrorCode;
    return {
      id: a.id,
      bookingCode: a.bookingCode,
      status: a.status as Booking['status'],
      channel: a.channel as Booking['channel'],
      quotaBucket: a.quotaBucket as Booking['quotaBucket'],
      patientId: a.patientId,
      sessionId: a.sessionId,
      serviceDate: isoFromDbDate(a.appointmentDate),
      start: hhmmFromDbTime(a.session.startTime),
      end: hhmmFromDbTime(a.session.endTime),
      practitionerId: a.practitionerId,
      practitionerName: a.practitioner.name,
      serviceId: a.serviceId,
      poliCode: a.service.code,
      poliName: a.service.name,
      queueNo: poliTicket?.ticketNo ?? '',
      estimatedAt: a.estimatedAt?.toISOString() ?? null,
      jkn: jknKind && a.referenceNumber ? { visitKind: jknKind, referenceNumber: a.referenceNumber } : null,
      checkedInAt: a.checkedInAt?.toISOString() ?? null,
      cancelledAt: a.cancelledAt?.toISOString() ?? null,
      cancelReason: a.cancelReason,
      bpjs: {
        status,
        sentAt: a.bpjsSyncedAt?.toISOString() ?? null,
        error: errorCode
          ? {
              code: errorCode,
              message:
                (BPJS_REJECTIONS as Record<string, string>)[errorCode] ?? SYNC_ERRORS[errorCode] ?? errorCode,
            }
          : null,
      },
      createdAt: a.createdAt.toISOString(),
    };
  }
}

function toTicket(t: TicketRow): QueueTicket {
  return {
    id: t.id,
    serviceId: t.serviceId,
    serviceCode: t.service.code,
    queueNo: t.ticketNo,
    serviceDate: isoFromDbDate(t.serviceDate),
    status: t.status as QueueTicket['status'],
    source: t.source as QueueTicket['source'],
    reserved: t.reserved,
    appointmentId: t.appointmentId,
    encounterId: t.encounters[0]?.id ?? null,
    patientId: t.patientId,
    issuedAt: t.createdAt.toISOString(),
    calledAt: null,
    callCount: 0,
    counter: null,
    startedAt: null,
    finishedAt: null,
    estimatedCallAt: null,
  };
}
