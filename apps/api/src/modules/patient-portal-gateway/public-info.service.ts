import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  hhmmFromDbTime,
  isModuleEnabled,
  isoFromDbDate,
  readTenantSetting,
  resolveTenantByCode,
  type TenantTx,
} from '@simrs/db';
import {
  AppError,
  frontOfficeError,
  isoDateJakarta,
  type PublicBookingStatus,
  type PublicBookingStatusQuery,
  type PublicQueue,
  type PublicSchedule,
  publicBookingStatusSchema,
  publicQueueSchema,
  publicScheduleSchema,
} from '@simrs/shared';
import { API_ENV, type ApiEnv } from '../../config/env';
import { type AuditMeta, writeAudit } from '../../infra/audit-writer';
import { PrismaService } from '../../infra/prisma.service';
import { RateLimitStorage } from '../../infra/rate-limit.storage';
import { PublicInfoRepository as repo } from './public-info.repository';

const TENANT_CODE = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
const DAY_MS = 86_400_000;
/** Pembanding tanggal lahir saat booking tidak ada, agar jalur gagal tetap melakukan perbandingan yang sama. */
const DUMMY_BIRTH_DATE = '0000-00-00';
/** Nama penghitung tanggal lahir salah per kode booking (`RateLimitStorage.failures`). */
const BOOKING_FAILURES = 'public-booking-status';

/** Kunci penghitung: hash kode RS + kode booking (nilai mentah tidak disimpan di Redis). */
const bookingSubject = (tenantCode: string, bookingCode: string) =>
  createHash('sha256').update(`${tenantCode.toUpperCase()}\u0000${bookingCode}`).digest('hex');

type BookingLookup =
  | { found: true; status: PublicBookingStatus }
  | { found: false; reason: 'not_found' | 'birth_date_mismatch' | 'too_many_failures' };

export interface PublicRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Tenant pengganti untuk jalur RS tidak dikenal (UUID nol; tidak pernah dipakai tenant nyata). */
const NO_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * RS tidak dikenal, tidak aktif, atau modul F08 dimatikan: jawaban sama (kode, pesan, header) dan kerja database yang
 * sama, sehingga daftar RS yang tidak membuka F08 tidak bocor. RS dengan F08 aktif memang publik (jadwalnya terbuka).
 */
const unknownTenant = () => new AppError('NOT_FOUND', 'Rumah sakit tidak ditemukan', 404);

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * F08 · Gateway informasi publik (rencana fase 2 potongan 8): tanpa login, tanpa PHI, dibatasi laju. RS dari kode di
 * path; semua bacaan di transaksi tenant (RLS) yang dibuka di sini. Setiap jawaban divalidasi skema ketat bersama
 * (`publicScheduleSchema` dkk.), sehingga kolom di luar kontrak (mis. identitas pasien) tidak mungkin terkirim.
 */
@Injectable()
export class PublicInfoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async tenant<T>(
    tenantCode: string,
    fn: (tx: TenantTx, tenantId: string) => Promise<T>,
  ): Promise<T> {
    const code = tenantCode.toUpperCase();
    if (!TENANT_CODE.test(code)) throw unknownTenant();
    const tenantId = await resolveTenantByCode(this.prisma.client, code);
    if (!tenantId) {
      // Kerja yang sama dengan RS yang ada tetapi F08 mati (transaksi bertenant + baca modul), agar waktu jawab tidak
      // membedakan keduanya. RLS dengan tenant kosong tidak mengembalikan baris apa pun.
      await this.prisma.forTenant(NO_TENANT_ID, (tx) => isModuleEnabled(tx, 'F08'));
      throw unknownTenant();
    }
    return this.prisma.forTenant(tenantId, async (tx) => {
      if (!(await isModuleEnabled(tx, 'F08'))) throw unknownTenant();
      return fn(tx, tenantId);
    });
  }

  /** Jadwal praktik + sisa kuota satu tanggal (hari ini s.d. batas booking RS, WIB). */
  schedules(tenantCode: string, date?: string): Promise<PublicSchedule> {
    return this.tenant(tenantCode, async (tx) => {
      const today = isoDateJakarta();
      const day = date ?? today;
      const maxDays = await readTenantSetting(tx, 'booking.max_days_ahead');
      const last = isoFromDbDate(new Date(Date.parse(`${today}T00:00:00Z`) + maxDays * DAY_MS));
      if (day < today || day > last) {
        throw new AppError('VALIDATION_FAILED', `Tanggal jadwal harus antara ${today} dan ${last}`, 400, {
          fields: ['date'],
        });
      }
      const sessions = await repo.sessions(tx, day);
      return publicScheduleSchema.parse({
        date: day,
        asOf: new Date().toISOString(),
        sessions: sessions.map((s) => ({
          poliName: s.service.name,
          practitionerName: s.practitioner.name,
          start: hhmmFromDbTime(s.startTime),
          end: hhmmFromDbTime(s.endTime),
          status: s.kind === 'cuti' ? 'cuti' : 'praktik',
          substituteName: s.substitute?.name ?? null,
          remaining: {
            jkn: s.kind === 'cuti' ? 0 : Math.max(0, s.quotaJkn - s.bookedJkn),
            nonJkn: s.kind === 'cuti' ? 0 : Math.max(0, s.quotaNonJkn - s.bookedNonJkn),
          },
        })),
      });
    });
  }

  /** Antrean berjalan hari ini (WIB): nomor yang sedang dipanggil/dilayani, jumlah menunggu, perkiraan tunggu. */
  queues(tenantCode: string, serviceCode?: string): Promise<PublicQueue> {
    return this.tenant(tenantCode, async (tx) => {
      const services = await repo.services(tx, serviceCode);
      if (serviceCode && services.length === 0) {
        throw new AppError('NOT_FOUND', 'Layanan antrean tidak ditemukan', 404);
      }
      const today = isoDateJakarta();
      const ids = services.map((s) => s.id);
      const [counts, calls, avgMinutes] = await Promise.all([
        repo.waitingCounts(tx, ids, today),
        repo.latestCalls(tx, ids, today),
        readTenantSetting(tx, 'queue.avg_service_minutes'),
      ]);
      const waitingBy = new Map(counts.map((c) => [c.serviceId, c._count._all]));
      const currentBy = new Map<string, string>();
      for (const c of calls)
        if (!currentBy.has(c.ticket.serviceId)) currentBy.set(c.ticket.serviceId, c.ticket.ticketNo);
      return publicQueueSchema.parse({
        asOf: new Date().toISOString(),
        services: services.map((s) => {
          const waiting = waitingBy.get(s.id) ?? 0;
          return {
            code: s.code,
            name: s.name,
            current: currentBy.get(s.id) ?? null,
            waiting,
            estimatedWaitMinutes: waiting * avgMinutes,
          };
        }),
      });
    });
  }

  /**
   * Status booking dari kode + tanggal lahir (keduanya di body). Tidak ada, tanggal lahir tidak cocok, kode yang
   * terkunci, atau RS tanpa modul → 404 `BOOKING_NOT_FOUND` yang sama (anti-enumerasi). Setiap percobaan diaudit tanpa
   * PHI (kode booking dan tanggal lahir tidak dicatat): berhasil = `read appointment` dengan id pasien; gagal = `denied`
   * + alasan internal.
   *
   * Batas per kode booking (review keamanan fase 2): tanggal lahir salah dihitung per kode RS + kode booking, apa pun
   * IP-nya. Setelah `BOOKING_STATUS_MAX_FAILURES` dalam jendela, kode itu dijawab 404 seragam (juga untuk tanggal lahir
   * yang benar) dengan alasan audit `too_many_failures`, sehingga tebakan tanggal lahir dari banyak IP tidak bisa
   * dijumlahkan. Pencarian dan perbandingan tetap dijalankan agar waktu jawab tidak berbeda.
   */
  async bookingStatus(
    tenantCode: string,
    input: PublicBookingStatusQuery,
    m: PublicRequestMeta,
  ): Promise<PublicBookingStatus> {
    const subject = bookingSubject(tenantCode, input.bookingCode);
    const locked =
      (await this.limits.failures(BOOKING_FAILURES, subject)) >= this.env.BOOKING_STATUS_MAX_FAILURES;
    const result = await this.tenant(tenantCode, async (tx, tenantId): Promise<BookingLookup> => {
      const appt = await repo.bookingByCode(tx, input.bookingCode);
      const stored = appt?.patient.birthDate ? isoFromDbDate(appt.patient.birthDate) : DUMMY_BIRTH_DATE;
      const birthMatch = sameText(stored, input.birthDate) && !!appt;
      const reason = !appt
        ? 'not_found'
        : locked
          ? 'too_many_failures'
          : birthMatch
            ? null
            : 'birth_date_mismatch';
      const meta: AuditMeta = {
        actorUserId: null,
        actorRole: null,
        ip: m.ip,
        userAgent: m.userAgent?.slice(0, 300) ?? null,
        requestId: m.requestId,
      };
      await writeAudit(tx, tenantId, meta, [
        {
          action: 'read',
          resourceType: 'appointment',
          resourceId: appt?.id ?? null,
          patientId: reason === null ? (appt?.patientId ?? null) : null,
          outcome: reason === null ? 'success' : 'denied',
          details: { channel: 'public_gateway', ...(reason === null ? {} : { reason }) },
        },
      ]);
      if (!appt || reason !== null) return { found: false, reason: reason ?? 'not_found' };

      const serviceDate = isoFromDbDate(appt.appointmentDate);
      let currentQueueNo: string | null = null;
      if (serviceDate === isoDateJakarta()) {
        const [call] = await repo.latestCalls(tx, [appt.serviceId], serviceDate);
        currentQueueNo = call?.ticket.ticketNo ?? null;
      }
      return {
        found: true,
        status: publicBookingStatusSchema.parse({
          bookingCode: appt.bookingCode,
          status: appt.status,
          serviceDate,
          start: hhmmFromDbTime(appt.session.startTime),
          poliName: appt.service.name,
          practitionerName: appt.practitioner.name,
          queueNo: appt.tickets[0]?.ticketNo ?? null,
          currentQueueNo,
          estimatedAt: appt.estimatedAt?.toISOString() ?? null,
        }),
      };
    });
    if (result.found) return result.status;
    // Hanya tanggal lahir salah untuk booking yang ada yang dihitung (kode tak dikenal tidak membuka apa pun).
    if (result.reason === 'birth_date_mismatch') {
      await this.limits.addFailure(
        BOOKING_FAILURES,
        subject,
        this.env.BOOKING_STATUS_FAILURE_WINDOW_MINUTES * 60_000,
      );
    }
    // Di luar transaksi: audit percobaan gagal sudah di-commit sebelum 404 dilempar.
    throw frontOfficeError('BOOKING_NOT_FOUND');
  }
}
