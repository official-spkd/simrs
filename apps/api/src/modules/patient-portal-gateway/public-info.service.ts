import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
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
import { type AuditMeta, writeAudit } from '../../infra/audit-writer';
import { PrismaService } from '../../infra/prisma.service';
import { PublicInfoRepository as repo } from './public-info.repository';

const TENANT_CODE = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
const DAY_MS = 86_400_000;
/** Pembanding tanggal lahir saat booking tidak ada, agar jalur gagal tetap melakukan perbandingan yang sama. */
const DUMMY_BIRTH_DATE = '0000-00-00';

export interface PublicRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** RS tidak dikenal, tidak aktif, atau modul F08 dimatikan: jawaban sama (tidak membocorkan daftar RS). */
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
  constructor(private readonly prisma: PrismaService) {}

  private async tenant<T>(
    tenantCode: string,
    fn: (tx: TenantTx, tenantId: string) => Promise<T>,
  ): Promise<T> {
    const code = tenantCode.toUpperCase();
    if (!TENANT_CODE.test(code)) throw unknownTenant();
    const tenantId = await resolveTenantByCode(this.prisma.client, code);
    if (!tenantId) throw unknownTenant();
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
   * Status booking dari kode + tanggal lahir (keduanya di body). Tidak ada, tanggal lahir tidak cocok, atau RS tanpa
   * modul → 404 `BOOKING_NOT_FOUND` yang sama (anti-enumerasi). Setiap percobaan diaudit tanpa PHI (kode booking dan
   * tanggal lahir tidak dicatat): berhasil = `read appointment` dengan id pasien; gagal = `denied` + alasan internal.
   */
  async bookingStatus(
    tenantCode: string,
    input: PublicBookingStatusQuery,
    m: PublicRequestMeta,
  ): Promise<PublicBookingStatus> {
    const result = await this.tenant(tenantCode, async (tx, tenantId) => {
      const appt = await repo.bookingByCode(tx, input.bookingCode);
      const stored = appt?.patient.birthDate ? isoFromDbDate(appt.patient.birthDate) : DUMMY_BIRTH_DATE;
      const match = sameText(stored, input.birthDate) && !!appt;
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
          patientId: match ? (appt?.patientId ?? null) : null,
          outcome: match ? 'success' : 'denied',
          details: {
            channel: 'public_gateway',
            ...(match ? {} : { reason: appt ? 'birth_date_mismatch' : 'not_found' }),
          },
        },
      ]);
      if (!appt || !match) return null;

      const serviceDate = isoFromDbDate(appt.appointmentDate);
      let currentQueueNo: string | null = null;
      if (serviceDate === isoDateJakarta()) {
        const [call] = await repo.latestCalls(tx, [appt.serviceId], serviceDate);
        currentQueueNo = call?.ticket.ticketNo ?? null;
      }
      return publicBookingStatusSchema.parse({
        bookingCode: appt.bookingCode,
        status: appt.status,
        serviceDate,
        start: hhmmFromDbTime(appt.session.startTime),
        poliName: appt.service.name,
        practitionerName: appt.practitioner.name,
        queueNo: appt.tickets[0]?.ticketNo ?? null,
        currentQueueNo,
        estimatedAt: appt.estimatedAt?.toISOString() ?? null,
      });
    });
    // Di luar transaksi: audit percobaan gagal sudah di-commit sebelum 404 dilempar.
    if (!result) throw frontOfficeError('BOOKING_NOT_FOUND');
    return result;
  }
}
