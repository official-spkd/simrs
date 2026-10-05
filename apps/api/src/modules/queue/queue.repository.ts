import { Injectable } from '@nestjs/common';
import { allocateQueueNumber, type Prisma, readTenantSetting, toDbDate } from '@simrs/db';
import type { QueueCallAction, QueueTicketSource, QueueTicketStatus } from '@simrs/shared';
import { newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const serviceSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  unitId: true,
  room: true,
  floor: true,
  active: true,
} as const satisfies Prisma.QueueServiceSelect;
export type ServiceRow = Prisma.QueueServiceGetPayload<{ select: typeof serviceSelect }>;

const callSelect = {
  id: true,
  ticketId: true,
  action: true,
  counter: true,
  calledAt: true,
  calledBy: true,
} as const satisfies Prisma.QueueCallSelect;
export type CallRow = Prisma.QueueCallGetPayload<{ select: typeof callSelect }>;

const ticketSelect = {
  id: true,
  serviceId: true,
  serviceDate: true,
  ticketNo: true,
  appointmentId: true,
  patientId: true,
  source: true,
  status: true,
  reserved: true,
  createdAt: true,
  service: { select: serviceSelect },
  calls: { select: callSelect, orderBy: [{ calledAt: 'asc' }, { id: 'asc' }] },
  encounters: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 },
} as const satisfies Prisma.QueueTicketSelect;
export type TicketRow = Prisma.QueueTicketGetPayload<{ select: typeof ticketSelect }>;

/** F04 · Akses data antrean (selalu transaksi bertenant permintaan). */
@Injectable()
export class QueueRepository {
  constructor(private readonly db: TenantDb) {}

  listServices(unitId?: string | null) {
    return this.db.tx().queueService.findMany({
      where: { active: true, ...(unitId === undefined ? {} : { unitId }) },
      select: serviceSelect,
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });
  }

  service(id: string) {
    return this.db.tx().queueService.findUnique({ where: { id }, select: serviceSelect });
  }

  tickets(serviceId: string, serviceDate: string, status?: QueueTicketStatus) {
    return this.db.tx().queueTicket.findMany({
      where: { serviceId, serviceDate: toDbDate(serviceDate), ...(status ? { status } : {}) },
      select: ticketSelect,
      orderBy: { seq: 'asc' },
    });
  }

  ticket(id: string) {
    return this.db.tx().queueTicket.findUnique({ where: { id }, select: ticketSelect });
  }

  /** Kunci baris tiket untuk transisi status (dua petugas menekan tombol bersamaan → berurutan). */
  async lockTicket(id: string): Promise<boolean> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM queue_tickets WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  /**
   * Tiket menunggu berikutnya (FIFO nomor), melewati nomor cadangan booking. `SKIP LOCKED`: dua loket yang menekan
   * "panggil berikutnya" bersamaan mendapat tiket berbeda.
   */
  async lockNextWaiting(serviceId: string, serviceDate: string): Promise<string | null> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM queue_tickets
      WHERE service_id = ${serviceId}::uuid AND service_date = ${serviceDate}::date
        AND status = 'waiting' AND NOT reserved
      ORDER BY seq
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    return rows[0]?.id ?? null;
  }

  async createTicket(input: {
    serviceId: string;
    serviceDate: string;
    source: QueueTicketSource;
    appointmentId: string | null;
    patientId: string | null;
  }) {
    const tenantId = this.db.tenantId();
    const { seq, ticketNo } = await allocateQueueNumber(
      this.db.tx(),
      tenantId,
      input.serviceId,
      input.serviceDate,
    );
    const id = newId();
    await this.db.tx().queueTicket.create({
      data: {
        id,
        tenantId,
        serviceId: input.serviceId,
        serviceDate: toDbDate(input.serviceDate),
        seq,
        ticketNo,
        appointmentId: input.appointmentId,
        patientId: input.patientId,
        source: input.source,
        createdBy: this.db.actorUserId(),
      },
    });
    return id;
  }

  setStatus(id: string, status: QueueTicketStatus) {
    return this.db.tx().queueTicket.update({
      where: { id },
      data: { status, updatedBy: this.db.actorUserId() },
    });
  }

  /** Tautkan tiket (mis. tiket loket walk-in) ke booking/pasien setelah terdaftar. */
  attachAppointment(id: string, appointmentId: string, patientId: string) {
    return this.db.tx().queueTicket.update({
      where: { id },
      data: { appointmentId, patientId, updatedBy: this.db.actorUserId() },
    });
  }

  async insertCall(ticketId: string, action: QueueCallAction, counter: string | null): Promise<CallRow> {
    return this.db.tx().queueCall.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        ticketId,
        action,
        counter,
        calledBy: this.db.actorUserId(),
      },
      select: callSelect,
    });
  }

  appointment(id: string) {
    return this.db.tx().appointment.findUnique({
      where: { id },
      select: { id: true, patientId: true, quotaBucket: true, serviceId: true, status: true },
    });
  }

  avgServiceMinutes(): Promise<number> {
    return readTenantSetting(this.db.tx(), 'queue.avg_service_minutes');
  }

  // ------------------------------------------------------------------------------------------------------------
  // Display
  // ------------------------------------------------------------------------------------------------------------

  display(id: string) {
    return this.db.tx().queueDisplay.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        services: {
          where: { active: true, service: { active: true } },
          orderBy: { position: 'asc' },
          select: { service: { select: serviceSelect } },
        },
      },
    });
  }

  /** Panggilan (`call`/`recall`) hari ini untuk layanan-layanan ini, terbaru dulu. */
  recentCalls(serviceIds: string[], serviceDate: string, take: number) {
    return this.db.tx().queueCall.findMany({
      where: {
        action: { in: ['call', 'recall'] },
        ticket: { serviceId: { in: serviceIds }, serviceDate: toDbDate(serviceDate) },
      },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        ...callSelect,
        ticket: {
          select: { ticketNo: true, status: true, serviceId: true, service: { select: { code: true } } },
        },
      },
    });
  }

  /** Dokter sesi praktik hari ini per layanan (urut jam mulai). */
  sessionsToday(serviceIds: string[], serviceDate: string) {
    return this.db.tx().scheduleSession.findMany({
      where: { serviceId: { in: serviceIds }, sessionDate: toDbDate(serviceDate), kind: 'praktik' },
      orderBy: { startTime: 'asc' },
      select: { serviceId: true, note: true, practitioner: { select: { name: true } } },
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Task ID BPJS
  // ------------------------------------------------------------------------------------------------------------

  bpjsTasks(appointmentId: string) {
    return this.db.tx().bpjsQueueTask.findMany({
      where: { appointmentId },
      orderBy: [{ occurredAt: 'asc' }, { taskId: 'asc' }],
    });
  }
}
