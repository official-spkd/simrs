import { Injectable } from '@nestjs/common';
import { dbDateFromIso, dbTimeFromHhmm, enqueueOutbox, hhmmFromDbTime, isoFromDbDate } from '@simrs/db';
import {
  hfisPullSnapshotSchema,
  newId,
  type OutboxEnvelope,
  type ScheduleTemplateInput,
  type UpdateScheduleTemplateInput,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import type { HfisMapping, HfisPull, RsSession } from './scheduling.view';

const SESSION_INCLUDE = {
  practitioner: { select: { name: true } },
  substitute: { select: { name: true } },
  service: { select: { code: true, name: true, room: true } },
} as const;

const TEMPLATE_INCLUDE = {
  practitioner: { select: { name: true } },
  service: { select: { code: true, name: true } },
} as const;

/** Booking yang masih menunggu pelayanan (yang terdampak cuti/pengalihan). */
export const ACTIVE_BOOKING_STATUSES = ['booked', 'checked_in'] as const;

type SessionRow = {
  id: string;
  practitionerId: string;
  serviceId: string;
  sessionDate: Date;
  startTime: Date;
  endTime: Date;
  kind: string;
  substituteId: string | null;
  note: string | null;
  quotaJkn: number;
  quotaNonJkn: number;
  bookedJkn: number;
  bookedNonJkn: number;
  updatedAt: Date;
  transferredAt: Date | null;
  practitioner: { name: string };
  substitute: { name: string } | null;
  service: { code: string; name: string; room: string | null };
};

function toRsSession(r: SessionRow): RsSession {
  return {
    id: r.id,
    practitionerId: r.practitionerId,
    practitionerName: r.practitioner.name,
    serviceId: r.serviceId,
    serviceCode: r.service.code,
    serviceName: r.service.name,
    room: r.service.room,
    date: isoFromDbDate(r.sessionDate),
    start: hhmmFromDbTime(r.startTime),
    end: hhmmFromDbTime(r.endTime),
    kind: r.kind === 'cuti' ? 'cuti' : 'praktik',
    substituteId: r.substituteId,
    substituteName: r.substitute?.name ?? null,
    note: r.note,
    quotaJkn: r.quotaJkn,
    quotaNonJkn: r.quotaNonJkn,
    bookedJkn: r.bookedJkn,
    bookedNonJkn: r.bookedNonJkn,
    updatedAt: r.updatedAt,
    transferredAt: r.transferredAt,
  };
}

/** F01 · Akses data jadwal (transaksi permintaan, RLS aktif). */
@Injectable()
export class SchedulingRepository {
  constructor(private readonly db: TenantDb) {}

  private actor() {
    return this.db.actorUserId();
  }

  tenantId(): string {
    return this.db.tenantId();
  }

  // ---------- sesi ----------

  async sessions(q: {
    from: string;
    to: string;
    serviceId?: string;
    practitionerId?: string;
    kind?: string;
  }): Promise<RsSession[]> {
    const rows = await this.db.tx().scheduleSession.findMany({
      where: {
        sessionDate: { gte: dbDateFromIso(q.from), lte: dbDateFromIso(q.to) },
        ...(q.serviceId ? { serviceId: q.serviceId } : {}),
        ...(q.practitionerId
          ? { OR: [{ practitionerId: q.practitionerId }, { substituteId: q.practitionerId }] }
          : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        service: { active: true },
      },
      include: SESSION_INCLUDE,
      orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(toRsSession);
  }

  async session(id: string): Promise<RsSession | null> {
    const row = await this.db.tx().scheduleSession.findUnique({ where: { id }, include: SESSION_INCLUDE });
    return row ? toRsSession(row) : null;
  }

  /**
   * Ubah kuota dengan satu UPDATE bersyarat (tidak di bawah booking, dan bila diberi: versi sama), sehingga booking
   * serentak tidak bisa terlewati. Hasil false = syarat tidak terpenuhi (pemanggil menentukan sebabnya).
   */
  async updateQuota(
    id: string,
    quotaJkn: number,
    quotaNonJkn: number,
    baseUpdatedAt: Date | undefined,
  ): Promise<boolean> {
    const res = await this.db.tx().scheduleSession.updateMany({
      where: {
        id,
        kind: 'praktik',
        bookedJkn: { lte: quotaJkn },
        bookedNonJkn: { lte: quotaNonJkn },
        ...(baseUpdatedAt ? { updatedAt: baseUpdatedAt } : {}),
      },
      data: { quotaJkn, quotaNonJkn, updatedBy: this.actor() },
    });
    return res.count === 1;
  }

  async recordLeave(id: string, substituteId: string | null, note: string): Promise<boolean> {
    const res = await this.db.tx().scheduleSession.updateMany({
      where: { id, kind: 'praktik' },
      data: { kind: 'cuti', substituteId, note, updatedBy: this.actor() },
    });
    return res.count === 1;
  }

  countActiveBookings(sessionId: string): Promise<number> {
    return this.db.tx().appointment.count({
      where: { sessionId, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
    });
  }

  /** Booking yang belum datang (dijadwal ulang saat pindah sesi); yang sudah check-in tetap di sesinya. */
  bookedAppointments(sessionId: string) {
    return this.db.tx().appointment.findMany({
      where: { sessionId, status: 'booked' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Alihkan booking aktif sesi ini ke dokter pengganti (pasien tetap di sesi, kode booking dan nomor antrean tetap).
   * Mengembalikan ID booking yang BARU dialihkan; yang sudah atas nama pengganti tidak dihitung lagi.
   */
  async assignSubstitute(sessionId: string, substituteId: string): Promise<string[]> {
    const rows = await this.db.tx().appointment.findMany({
      where: {
        sessionId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        practitionerId: { not: substituteId },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return [];
    await this.db.tx().appointment.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { practitionerId: substituteId, updatedBy: this.actor() },
    });
    return rows.map((r) => r.id);
  }

  async markTransferred(sessionId: string, target: 'substitute' | 'session') {
    const actor = this.actor();
    await this.db.tx().scheduleSession.update({
      where: { id: sessionId },
      data: { transferredAt: new Date(), transferredBy: actor, transferTarget: target, updatedBy: actor },
    });
  }

  /** Praktisi aktif yang punya templat aktif di layanan ini (syarat dokter pengganti "poli yang sama"). */
  async practitionerServesService(practitionerId: string, serviceId: string): Promise<boolean> {
    const n = await this.db.tx().practitionerSchedule.count({
      where: { practitionerId, serviceId, active: true, practitioner: { active: true } },
    });
    return n > 0;
  }

  // ---------- HFIS ----------

  async hfisMapping(): Promise<HfisMapping> {
    const rows = await this.db.tx().externalId.findMany({
      where: { active: true, system: { in: ['bpjs:hfis-dokter', 'bpjs:poli'] } },
      select: { entity: true, entityId: true, system: true, value: true },
    });
    const doctorIds = rows.filter((r) => r.system === 'bpjs:hfis-dokter' && /^\d+$/.test(r.value));
    const names = new Map(
      (
        await this.db.tx().practitioner.findMany({
          where: { id: { in: doctorIds.map((r) => r.entityId) } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.id, p.name]),
    );
    const doctorCode = new Map<string, number>();
    const practitionerByCode = new Map<number, { id: string; name: string }>();
    for (const r of doctorIds) {
      const code = Number(r.value);
      doctorCode.set(r.entityId, code);
      practitionerByCode.set(code, { id: r.entityId, name: names.get(r.entityId) ?? '' });
    }
    const poliCode = new Map(
      rows.filter((r) => r.system === 'bpjs:poli').map((r) => [r.entityId, r.value] as const),
    );
    return { doctorCode, practitionerByCode, poliCode };
  }

  async hfisPulls(from: string, to: string): Promise<HfisPull[]> {
    const rows = await this.db.tx().hfisScheduleSnapshot.findMany({
      where: { direction: 'pull', periodStart: { gte: dbDateFromIso(from), lte: dbDateFromIso(to) } },
      select: { fetchedAt: true, payload: true },
      orderBy: { fetchedAt: 'desc' },
      take: 2000,
    });
    return rows.flatMap((r) => {
      const parsed = hfisPullSnapshotSchema.safeParse(r.payload);
      return parsed.success ? [{ fetchedAt: r.fetchedAt, snapshot: parsed.data }] : [];
    });
  }

  /** Pasangan dokter × poli dengan templat aktif (kandidat kirim ke HFIS). */
  activeTemplatePairs(filter: { practitionerIds?: string[]; serviceId?: string }) {
    return this.db.tx().practitionerSchedule.findMany({
      where: {
        active: true,
        ...(filter.practitionerIds ? { practitionerId: { in: filter.practitionerIds } } : {}),
        ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
      },
      select: { practitionerId: true, serviceId: true },
      distinct: ['practitionerId', 'serviceId'],
    });
  }

  /** Revisi berikutnya `bpjs.hfis.update` untuk pasangan ini (jumlah pesan sebelumnya + 1). */
  async nextHfisRevision(practitionerId: string, serviceId: string): Promise<number> {
    const n = await this.db.tx().outboxMessage.count({
      where: {
        operation: 'bpjs.hfis.update',
        idempotencyKey: { startsWith: `bpjs.hfis.update:${practitionerId}:${serviceId}:` },
      },
    });
    return n + 1;
  }

  enqueue(msg: OutboxEnvelope) {
    return enqueueOutbox(this.db.tx(), this.tenantId(), msg);
  }

  poliServices(serviceId?: string) {
    return this.db.tx().queueService.findMany({
      where: { kind: 'poli', active: true, ...(serviceId ? { id: serviceId } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  // ---------- templat ----------

  templates(q: { practitionerId?: string; serviceId?: string }) {
    return this.db.tx().practitionerSchedule.findMany({
      where: {
        ...(q.practitionerId ? { practitionerId: q.practitionerId } : {}),
        ...(q.serviceId ? { serviceId: q.serviceId } : {}),
      },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ practitionerId: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }],
    });
  }

  template(id: string) {
    return this.db.tx().practitionerSchedule.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  }

  /** Templat aktif dokter ini di hari yang sama, untuk cek bentrok jam (pengecualian `exceptId`). */
  sameDayTemplates(practitionerId: string, weekday: number, exceptId?: string) {
    return this.db.tx().practitionerSchedule.findMany({
      where: { practitionerId, weekday, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { startTime: true, endTime: true, validFrom: true, validUntil: true },
    });
  }

  findPractitioner(id: string) {
    return this.db.tx().practitioner.findUnique({ where: { id }, select: { id: true, active: true } });
  }

  findPoliService(id: string) {
    return this.db
      .tx()
      .queueService.findUnique({ where: { id }, select: { id: true, kind: true, active: true } });
  }

  createTemplate(input: ScheduleTemplateInput) {
    const actor = this.actor();
    return this.db.tx().practitionerSchedule.create({
      data: {
        id: newId(),
        tenantId: this.tenantId(),
        practitionerId: input.practitionerId,
        serviceId: input.serviceId,
        weekday: input.weekday,
        startTime: dbTimeFromHhmm(input.start),
        endTime: dbTimeFromHhmm(input.end),
        quotaJkn: input.quotaJkn,
        quotaNonJkn: input.quotaNonJkn,
        validFrom: dbDateFromIso(input.validFrom),
        validUntil: input.validUntil ? dbDateFromIso(input.validUntil) : null,
        createdBy: actor,
        updatedBy: actor,
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  updateTemplate(id: string, input: UpdateScheduleTemplateInput) {
    return this.db.tx().practitionerSchedule.update({
      where: { id },
      data: {
        ...(input.start ? { startTime: dbTimeFromHhmm(input.start) } : {}),
        ...(input.end ? { endTime: dbTimeFromHhmm(input.end) } : {}),
        ...(input.quotaJkn !== undefined ? { quotaJkn: input.quotaJkn } : {}),
        ...(input.quotaNonJkn !== undefined ? { quotaNonJkn: input.quotaNonJkn } : {}),
        ...(input.validUntil !== undefined
          ? { validUntil: input.validUntil ? dbDateFromIso(input.validUntil) : null }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedBy: this.actor(),
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  /** Nomor antrean terakhir layanan pada tanggal itu (tanpa mengalokasikan). */
  async lastQueueNumber(serviceId: string, date: string): Promise<number> {
    const row = await this.db.tx().numberSequence.findFirst({
      where: {
        kind: `queue_${serviceId.replaceAll('-', '').toLowerCase()}`,
        period: date.slice(2).replaceAll('-', ''),
      },
      select: { lastValue: true },
    });
    return Number(row?.lastValue ?? 0);
  }
}
