import { Injectable } from '@nestjs/common';
import {
  addIsoDays,
  enqueueHfisPull,
  generateScheduleSessions,
  isoWeekday,
  readTenantSetting,
} from '@simrs/db';
import {
  AppError,
  BPJS_HFIS_UPDATE_OPERATION,
  frontOfficeError,
  type HfisDifferences,
  type HfisPullInput,
  type HfisPushInput,
  isoDateJakarta,
  outboxKey,
  PATIENT_WHATSAPP_SCHEDULE_CHANGED_OPERATION,
  type PractitionerQuota,
  type RecordLeaveInput,
  type ScheduleSession,
  type ScheduleTemplate,
  type ScheduleTemplateInput,
  toWallClock,
  type TransferBookingsInput,
  type UpdateScheduleTemplateInput,
  type UpdateSessionQuotaInput,
  type WeeklySchedule,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { SchedulingRepository } from './scheduling.repository';
import { buildWeek, compareWithHfis, latestPulls, type RsSession } from './scheduling.view';

const notFound = (what: string) => new AppError('NOT_FOUND', `${what} tidak ditemukan`, 404);
const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 400);

/** Rentang bawaan tarik HFIS (hari mulai hari ini). */
export const HFIS_PULL_DAYS = 14;

function hhmmPlus(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const overlap = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  a.start < b.end && b.start < a.end;

/**
 * F01 · Aturan jadwal praktik dan kuota:
 * - kuota tidak pernah di bawah booking (UPDATE bersyarat + CHECK DB) dan berversi (`baseUpdatedAt`);
 * - cuti hanya untuk sesi praktik hari ini/ke depan; pengganti = dokter lain yang praktik di poli yang sama;
 * - pengalihan memindahkan semua booking atau tidak sama sekali (kuota tujuan kurang → 409 `QUOTA_FULL`);
 * - efek ke luar (HFIS, WhatsApp pasien) hanya lewat outbox; cuti/kapasitas per tanggal dicatat di aplikasi HFIS.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly db: TenantDb,
  ) {}

  private today(): string {
    return isoDateJakarta(new Date());
  }

  private toSession(s: RsSession, synced: boolean): ScheduleSession {
    return {
      id: s.id,
      practitionerId: s.practitionerId,
      practitionerName: s.practitionerName,
      serviceId: s.serviceId,
      poliCode: s.serviceCode,
      poliName: s.serviceName,
      room: s.room,
      serviceDate: s.date,
      start: s.start,
      end: s.end,
      kind: s.kind,
      substitute:
        s.substituteId && s.substituteName
          ? { practitionerId: s.substituteId, practitionerName: s.substituteName }
          : null,
      note: s.note,
      quota: { jkn: s.quotaJkn, nonJkn: s.quotaNonJkn, bookedJkn: s.bookedJkn, bookedNonJkn: s.bookedNonJkn },
      hfisSynced: synced,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private async compare(sessions: RsSession[], from: string, to: string) {
    const dates: string[] = [];
    for (let d = from; d <= to; d = addIsoDays(d, 1)) dates.push(d);
    const [mapping, pulls, services] = await Promise.all([
      this.repo.hfisMapping(),
      this.repo.hfisPulls(from, to),
      this.repo.poliServices(),
    ]);
    return compareWithHfis({
      sessions,
      pulls: latestPulls(pulls),
      mapping,
      dates,
      serviceNames: new Map(services.map((s) => [s.id, s.name])),
    });
  }

  // ---------- baca ----------

  async week(weekStart: string, serviceId?: string): Promise<WeeklySchedule> {
    const sunday = addIsoDays(weekStart, 6);
    const sessions = await this.repo.sessions({ from: weekStart, to: sunday, serviceId });
    const lastDay = sessions.some((s) => isoWeekday(s.date) === 7) ? 6 : 5;
    const days = Array.from({ length: lastDay + 1 }, (_, i) => addIsoDays(weekStart, i));
    const comparison = await this.compare(sessions, weekStart, days.at(-1) ?? weekStart);
    return buildWeek({ weekStart, days, sessions, comparison });
  }

  async sessions(q: {
    from: string;
    to: string;
    serviceId?: string;
    practitionerId?: string;
    kind?: string;
  }) {
    const sessions = await this.repo.sessions(q);
    const { synced } = await this.compare(sessions, q.from, q.to);
    return sessions.map((s) => this.toSession(s, synced.has(s.id)));
  }

  async session(id: string): Promise<ScheduleSession> {
    const s = await this.repo.session(id);
    if (!s) throw notFound('Sesi praktik');
    const { synced } = await this.compare([s], s.date, s.date);
    return this.toSession(s, synced.has(s.id));
  }

  /** Kuota dokter hari ini untuk meja pendaftaran (sesi cuti berpengganti tampil atas nama pengganti). */
  async todayQuotas(q: { serviceId?: string; poliCode?: string }): Promise<PractitionerQuota[]> {
    const today = this.today();
    const avg = await readTenantSetting(this.db.tx(), 'queue.avg_service_minutes');
    const sessions = (await this.repo.sessions({ from: today, to: today, serviceId: q.serviceId })).filter(
      (s) => (!q.poliCode || s.serviceCode === q.poliCode) && (s.kind === 'praktik' || s.substituteId),
    );
    const out: PractitionerQuota[] = [];
    for (const s of sessions) {
      const last = await this.repo.lastQueueNumber(s.serviceId, today);
      const booked = s.bookedJkn + s.bookedNonJkn;
      const sub = s.kind === 'cuti' && s.substituteId;
      out.push({
        sessionId: s.id,
        doctorId: sub ? (s.substituteId as string) : s.practitionerId,
        doctorName: sub ? (s.substituteName ?? s.practitionerName) : s.practitionerName,
        poliCode: s.serviceCode,
        poliName: s.serviceName,
        room: s.room?.trim() || s.serviceName,
        start: toWallClock(s.start),
        end: toWallClock(s.end),
        jkn: { booked: s.bookedJkn, total: s.quotaJkn },
        nonJkn: { booked: s.bookedNonJkn, total: s.quotaNonJkn },
        nextQueueNo: `${s.serviceCode}-${String(Math.min(last + 1, 999)).padStart(3, '0')}`,
        eta: toWallClock(hhmmPlus(s.start, booked * avg)),
      });
    }
    return out;
  }

  async differences(from: string, to: string): Promise<HfisDifferences> {
    const sessions = await this.repo.sessions({ from, to });
    const c = await this.compare(sessions, from, to);
    return {
      from,
      to,
      lastPulledAt: c.lastPulledAt?.toISOString() ?? null,
      unpulledDates: c.unpulledDates,
      items: c.items,
    };
  }

  // ---------- ubah sesi ----------

  async updateQuota(id: string, input: UpdateSessionQuotaInput): Promise<ScheduleSession> {
    const s = await this.repo.session(id);
    if (!s) throw notFound('Sesi praktik');
    if (s.kind !== 'praktik')
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Kuota hanya bisa diubah pada sesi praktik');
    if (s.date < this.today())
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Sesi praktik ini sudah lewat');
    const base = input.baseUpdatedAt ? new Date(input.baseUpdatedAt) : undefined;
    if (base && base.getTime() !== s.updatedAt.getTime()) throw this.stale();
    if (input.quotaJkn < s.bookedJkn || input.quotaNonJkn < s.bookedNonJkn) throw this.belowBooked(s);
    if (!(await this.repo.updateQuota(id, input.quotaJkn, input.quotaNonJkn, base))) {
      // Booking/ubahan serentak masuk di antara baca dan tulis: baca ulang untuk sebab yang tepat.
      const now = await this.repo.session(id);
      if (now && (input.quotaJkn < now.bookedJkn || input.quotaNonJkn < now.bookedNonJkn)) {
        throw this.belowBooked(now);
      }
      throw this.stale();
    }
    return this.session(id);
  }

  private belowBooked(s: RsSession) {
    return frontOfficeError(
      'QUOTA_BELOW_BOOKED',
      { bookedJkn: s.bookedJkn, bookedNonJkn: s.bookedNonJkn },
      `Kuota tidak boleh di bawah booking: JKN ${s.bookedJkn}, non-JKN ${s.bookedNonJkn}`,
    );
  }

  private stale() {
    return new AppError('CONFLICT', 'Sesi sudah diubah petugas lain. Muat ulang lalu ulangi.', 409, {
      reason: 'STALE',
    });
  }

  async recordLeave(id: string, input: RecordLeaveInput) {
    const s = await this.repo.session(id);
    if (!s) throw notFound('Sesi praktik');
    if (s.kind !== 'praktik')
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Cuti hanya bisa dicatat pada sesi praktik');
    if (s.date < this.today())
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Sesi praktik ini sudah lewat');
    const sub = input.substitutePractitionerId;
    if (sub) {
      if (sub === s.practitionerId) throw invalid('Dokter pengganti harus dokter lain');
      if (!(await this.repo.practitionerServesService(sub, s.serviceId))) {
        throw invalid('Dokter pengganti harus praktik di poli yang sama');
      }
    }
    if (!(await this.repo.recordLeave(id, sub, input.reason))) throw this.stale();
    return { session: await this.session(id), affectedBookings: await this.repo.countActiveBookings(id) };
  }

  async transfer(id: string, input: TransferBookingsInput) {
    const s = await this.repo.session(id);
    if (!s) throw notFound('Sesi praktik');
    if (s.kind !== 'cuti')
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Pengalihan hanya untuk sesi cuti');
    let moved: string[];
    if (input.target.kind === 'substitute') {
      if (!s.substituteId) throw invalid('Sesi cuti ini belum punya dokter pengganti');
      const appointments = await this.repo.bookedAppointments(id);
      await this.repo.assignSubstitute(id, s.substituteId);
      moved = appointments.map((a) => a.id);
    } else {
      const target = await this.repo.session(input.target.sessionId);
      if (!target) throw notFound('Sesi tujuan');
      if (target.id === s.id) throw invalid('Sesi tujuan sama dengan sesi cuti');
      if (target.serviceId !== s.serviceId) throw invalid('Sesi tujuan harus di poli yang sama');
      if (target.date < this.today())
        throw frontOfficeError('SESSION_CLOSED', undefined, 'Sesi tujuan sudah lewat');
      if (target.kind !== 'praktik' && !target.substituteId) {
        throw frontOfficeError('SESSION_CLOSED', undefined, 'Sesi tujuan tidak menerima pasien');
      }
      const appointments = await this.repo.bookedAppointments(id);
      for (const a of appointments) {
        const bucket = a.quotaBucket === 'jkn' ? 'jkn' : 'non_jkn';
        // Satu gagal = seluruh transaksi batal: tidak ada pasien yang dipindah sebagian.
        if (!(await this.repo.reserve(target.id, bucket))) {
          throw frontOfficeError(
            'QUOTA_FULL',
            { needed: appointments.length },
            'Kuota sesi tujuan tidak cukup untuk semua pasien',
          );
        }
        await this.repo.release(id, bucket);
        await this.repo.moveAppointment(a.id, target);
      }
      moved = appointments.map((a) => a.id);
    }
    let notified = 0;
    if (input.notifyPatients) {
      const run = Math.floor(Date.now() / 1000);
      for (const appointmentId of moved) {
        await this.repo.enqueue({
          target: 'whatsapp',
          operation: PATIENT_WHATSAPP_SCHEDULE_CHANGED_OPERATION,
          idempotencyKey: outboxKey(PATIENT_WHATSAPP_SCHEDULE_CHANGED_OPERATION, appointmentId, run),
          payload: { appointmentId },
        });
        notified++;
      }
    }
    return { moved: moved.length, notified };
  }

  async generate(input: { from?: string; days?: number }) {
    const days = input.days ?? (await readTenantSetting(this.db.tx(), 'booking.max_days_ahead'));
    return generateScheduleSessions(this.db.tx(), this.repo.tenantId(), {
      from: input.from ?? this.today(),
      days,
      actorUserId: this.db.actorUserId(),
    });
  }

  // ---------- HFIS ----------

  /** Antrekan `bpjs.hfis.update` per dokter × poli yang punya kode HFIS + kode poli BPJS dan templat aktif. */
  async hfisPush(input: HfisPushInput) {
    const [pairs, mapping] = await Promise.all([
      this.repo.activeTemplatePairs({ practitionerIds: input.practitionerIds, serviceId: input.serviceId }),
      this.repo.hfisMapping(),
    ]);
    let queued = 0;
    let skipped = 0;
    for (const p of pairs) {
      if (!mapping.doctorCode.has(p.practitionerId) || !mapping.poliCode.has(p.serviceId)) {
        skipped++;
        continue;
      }
      const revision = await this.repo.nextHfisRevision(p.practitionerId, p.serviceId);
      await this.repo.enqueue({
        target: 'bpjs',
        operation: BPJS_HFIS_UPDATE_OPERATION,
        idempotencyKey: outboxKey(BPJS_HFIS_UPDATE_OPERATION, `${p.practitionerId}:${p.serviceId}`, revision),
        payload: { practitionerId: p.practitionerId, serviceId: p.serviceId, revision },
      });
      queued++;
    }
    return { queued, skipped };
  }

  /** Antrekan `bpjs.hfis.pull` per poli BPJS × tanggal (job berkala worker memakai helper yang sama). */
  async hfisPull(input: HfisPullInput) {
    const queued = await enqueueHfisPull(this.db.tx(), this.repo.tenantId(), {
      from: input.from ?? this.today(),
      days: input.days,
      serviceId: input.serviceId,
    });
    return { queued, skipped: 0 };
  }

  // ---------- templat ----------

  private template(t: Awaited<ReturnType<SchedulingRepository['template']>> & object): ScheduleTemplate {
    return {
      id: t.id,
      practitionerId: t.practitionerId,
      practitionerName: t.practitioner.name,
      serviceId: t.serviceId,
      poliCode: t.service.code,
      poliName: t.service.name,
      weekday: t.weekday,
      start: t.startTime.toISOString().slice(11, 16),
      end: t.endTime.toISOString().slice(11, 16),
      quotaJkn: t.quotaJkn,
      quotaNonJkn: t.quotaNonJkn,
      validFrom: t.validFrom.toISOString().slice(0, 10),
      validUntil: t.validUntil?.toISOString().slice(0, 10) ?? null,
      active: t.active,
    };
  }

  async templates(q: { practitionerId?: string; serviceId?: string }) {
    return (await this.repo.templates(q)).map((t) => this.template(t));
  }

  private async assertNoOverlap(
    practitionerId: string,
    weekday: number,
    v: { start: string; end: string; validFrom: string; validUntil: string | null },
    exceptId?: string,
  ) {
    for (const o of await this.repo.sameDayTemplates(practitionerId, weekday, exceptId)) {
      const oFrom = o.validFrom.toISOString().slice(0, 10);
      const oUntil = o.validUntil?.toISOString().slice(0, 10) ?? '9999-12-31';
      const periodOverlap = oFrom <= (v.validUntil ?? '9999-12-31') && v.validFrom <= oUntil;
      const hours = {
        start: o.startTime.toISOString().slice(11, 16),
        end: o.endTime.toISOString().slice(11, 16),
      };
      if (periodOverlap && overlap(hours, v)) throw frontOfficeError('SCHEDULE_OVERLAP');
    }
  }

  async createTemplate(input: ScheduleTemplateInput): Promise<ScheduleTemplate> {
    const p = await this.repo.findPractitioner(input.practitionerId);
    if (!p?.active) throw invalid('Praktisi tidak ditemukan atau nonaktif');
    const svc = await this.repo.findPoliService(input.serviceId);
    if (!svc?.active || svc.kind !== 'poli') throw invalid('Layanan harus poli aktif');
    await this.assertNoOverlap(input.practitionerId, input.weekday, {
      start: input.start,
      end: input.end,
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
    });
    return this.template(await this.repo.createTemplate(input));
  }

  async updateTemplate(id: string, input: UpdateScheduleTemplateInput): Promise<ScheduleTemplate> {
    const cur = await this.repo.template(id);
    if (!cur) throw notFound('Templat jadwal');
    const merged = this.template(cur);
    const start = input.start ?? merged.start;
    const end = input.end ?? merged.end;
    if (start >= end) throw invalid('Jam mulai harus sebelum jam selesai');
    const validUntil = input.validUntil === undefined ? merged.validUntil : input.validUntil;
    if (validUntil && validUntil < merged.validFrom) throw invalid('Berlaku sampai sebelum berlaku mulai');
    if (input.active ?? merged.active) {
      await this.assertNoOverlap(
        cur.practitionerId,
        cur.weekday,
        { start, end, validFrom: merged.validFrom, validUntil },
        id,
      );
    }
    return this.template(await this.repo.updateTemplate(id, input));
  }
}
