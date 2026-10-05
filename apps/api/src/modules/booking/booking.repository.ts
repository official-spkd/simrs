import { Injectable } from '@nestjs/common';
import { allocateQueueNumber, knownDbError, type Prisma, releaseQuota, reserveQuota } from '@simrs/db';
import type { QuotaBucketKind } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/** Kolom yang dibutuhkan untuk membentuk respons `Booking` (`bookingSchema`). */
export const APPOINTMENT_SELECT = {
  id: true,
  bookingCode: true,
  status: true,
  channel: true,
  quotaBucket: true,
  patientId: true,
  sessionId: true,
  practitionerId: true,
  serviceId: true,
  appointmentDate: true,
  jknVisitKind: true,
  referenceNumber: true,
  estimatedAt: true,
  checkedInAt: true,
  cancelledAt: true,
  cancelReason: true,
  bpjsSyncStatus: true,
  bpjsSyncedAt: true,
  bpjsErrorCode: true,
  createdAt: true,
  session: { select: { startTime: true, endTime: true } },
  practitioner: { select: { name: true } },
  service: { select: { code: true, name: true, unitId: true } },
  tickets: {
    select: {
      id: true,
      serviceId: true,
      serviceDate: true,
      seq: true,
      ticketNo: true,
      status: true,
      source: true,
      reserved: true,
      appointmentId: true,
      patientId: true,
      createdAt: true,
      service: { select: { code: true, kind: true } },
      encounters: { select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.AppointmentSelect;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>;
export type TicketRow = AppointmentRow['tickets'][number];

/** F02 · Akses data booking (transaksi permintaan, RLS aktif). */
@Injectable()
export class BookingRepository {
  constructor(private readonly db: TenantDb) {}

  findById(id: string) {
    return this.db.tx().appointment.findUnique({ where: { id }, select: APPOINTMENT_SELECT });
  }

  findByCode(bookingCode: string) {
    return this.db.tx().appointment.findUnique({
      where: { tenantId_bookingCode: { tenantId: this.db.tenantId(), bookingCode } },
      select: APPOINTMENT_SELECT,
    });
  }

  /** Kunci baris booking sampai transaksi selesai (batal/check-in/jadwal ulang serentak diserialkan). */
  async lock(id: string): Promise<void> {
    await this.db.tx().$queryRaw`SELECT id FROM appointments WHERE id = ${id}::uuid FOR UPDATE`;
  }

  list(q: {
    cursor?: string;
    limit: number;
    serviceDate?: Date;
    sessionId?: string;
    patientId?: string;
    status?: string;
    /** Lingkup `unit`: hanya booking di layanan/poli unit ini. */
    unitId?: string;
  }) {
    return this.db.tx().appointment.findMany({
      where: {
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
        ...(q.unitId ? { service: { unitId: q.unitId } } : {}),
        ...(q.serviceDate ? { appointmentDate: q.serviceDate } : {}),
        ...(q.sessionId ? { sessionId: q.sessionId } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      select: APPOINTMENT_SELECT,
    });
  }

  findPatient(id: string) {
    return this.db.tx().patient.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        mergedIntoId: true,
        identifiers: { where: { active: true }, select: { system: true } },
      },
    });
  }

  findSession(id: string) {
    return this.db.tx().scheduleSession.findUnique({
      where: { id },
      select: {
        id: true,
        practitionerId: true,
        serviceId: true,
        sessionDate: true,
        startTime: true,
        endTime: true,
        kind: true,
        substituteId: true,
        service: { select: { kind: true, active: true, unitId: true } },
      },
    });
  }

  hasActiveBooking(patientId: string, serviceId: string, date: Date, exceptId?: string) {
    return this.db.tx().appointment.count({
      where: {
        patientId,
        serviceId,
        appointmentDate: date,
        status: { in: ['booked', 'checked_in'] },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
  }

  reserve(sessionId: string, bucket: QuotaBucketKind) {
    return reserveQuota(this.db.tx(), sessionId, bucket);
  }

  release(sessionId: string, bucket: QuotaBucketKind) {
    return releaseQuota(this.db.tx(), sessionId, bucket);
  }

  allocateTicketNumber(serviceId: string, serviceDate: string) {
    return allocateQueueNumber(this.db.tx(), this.db.tenantId(), serviceId, serviceDate);
  }

  /** Layanan loket pendaftaran (admisi) yang aktif untuk tiket check-in JKN, atau null. */
  findCounterService() {
    return this.db.tx().queueService.findFirst({
      where: { kind: 'loket', active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true },
    });
  }

  async createAppointment(
    data: Omit<Prisma.AppointmentUncheckedCreateInput, 'tenantId'>,
  ): Promise<'ok' | 'duplicate'> {
    try {
      await this.db.tx().appointment.create({
        data: {
          ...data,
          tenantId: this.db.tenantId(),
          createdBy: this.db.actorUserId(),
          updatedBy: this.db.actorUserId(),
        },
      });
      return 'ok';
    } catch (err) {
      // Indeks unik parsial `appointments_one_active_per_day` (permintaan serentak untuk pasien yang sama).
      if (knownDbError(err)?.code === 'P2002') return 'duplicate';
      throw err;
    }
  }

  createTicket(data: Omit<Prisma.QueueTicketUncheckedCreateInput, 'tenantId'>) {
    return this.db.tx().queueTicket.create({
      data: {
        ...data,
        tenantId: this.db.tenantId(),
        createdBy: this.db.actorUserId(),
        updatedBy: this.db.actorUserId(),
      },
      select: { id: true },
    });
  }

  updateAppointment(id: string, data: Prisma.AppointmentUncheckedUpdateInput) {
    return this.db.tx().appointment.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: { id: true },
    });
  }

  /** Tiket booking yang belum dipakai ikut batal (tiket yang sudah dipanggil/dilayani dibiarkan). */
  cancelOpenTickets(appointmentId: string) {
    return this.db.tx().queueTicket.updateMany({
      where: { appointmentId, status: { in: ['waiting', 'skipped'] } },
      data: { status: 'cancelled', updatedBy: this.db.actorUserId() },
    });
  }
}
