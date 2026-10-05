import { Injectable } from '@nestjs/common';
import {
  AppError,
  type BpjsErrorCode,
  type BpjsQueueTask,
  bpjsErrorLabel,
  type BpjsSyncStatus,
  type CallTicketInput,
  frontOfficeError,
  isoDateJakarta,
  type IssueTicketInput,
  type QueueBoard,
  type QueueCallAction,
  type QueueCallRecord,
  type QueueDisplay,
  type QueueService as QueueServiceView,
  type QueueServiceKind,
  type QueueTicket,
  type QueueTicketStatus,
} from '@simrs/shared';
import { AuditedDenial } from '../../common/audited-denial';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { type CallRow, QueueRepository, type ServiceRow, type TicketRow } from './queue.repository';

/** Kode poli di papan TV (`queueBoardClinicSchema.poliCode`): 2 huruf. */
const BOARD_POLI_CODE = /^[A-Z]{2}$/;
const BOARD_MAX_CLINICS = 4;
const BOARD_HISTORY = 4;
const BOARD_INFO = 'Siapkan kartu identitas dan kartu JKN saat nomor Anda dipanggil.';

/** Transisi yang diizinkan per aksi petugas (status asal). */
const FROM: Record<Exclude<QueueCallAction, 'call'>, readonly QueueTicketStatus[]> = {
  recall: ['called', 'skipped'],
  skip: ['called'],
  start: ['waiting', 'called'],
  finish: ['serving'],
};
const TO: Record<QueueCallAction, QueueTicketStatus> = {
  call: 'called',
  recall: 'called',
  skip: 'skipped',
  start: 'serving',
  finish: 'done',
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * F04 · Antrean: layanan, tiket, panggilan, papan display, dan status task ID BPJS. Semua perubahan status tiket
 * dicatat append-only di `queue_calls` (sumber waktu task ID) dan diterbitkan sebagai event domain
 * (`queue.ticket_called|started|finished`) yang didengar mesin task ID (`BpjsTaskEngine`), bukan dari tombol.
 * Klinisi berlingkup `unit` hanya melihat/memanggil layanan milik unit sesinya.
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly repo: QueueRepository,
    private readonly db: TenantDb,
    private readonly events: DomainEvents,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Layanan dan tiket
  // ------------------------------------------------------------------------------------------------------------

  async listServices(): Promise<QueueServiceView[]> {
    const rows =
      this.db.permissionScope() === 'unit'
        ? await this.repo.listServices(this.db.actor().unitId ?? '00000000-0000-0000-0000-000000000000')
        : await this.repo.listServices();
    return rows.map(toServiceView);
  }

  async listTickets(serviceId: string, q: { serviceDate?: string; status?: QueueTicketStatus }) {
    await this.accessibleService(serviceId);
    const rows = await this.repo.tickets(serviceId, q.serviceDate ?? today(), q.status);
    return this.present(rows);
  }

  /** Ambil tiket di loket (staf). Tiket booking ikut tertaut ke pasiennya; tiket anjungan lewat endpoint perangkat. */
  async issueTicket(serviceId: string, input: IssueTicketInput): Promise<QueueTicket> {
    const service = await this.accessibleService(serviceId, { active: true });
    let appointmentId: string | null = null;
    let patientId: string | null = null;
    if (input.appointmentId) {
      const appt = await this.repo.appointment(input.appointmentId);
      if (!appt) throw frontOfficeError('BOOKING_NOT_FOUND');
      appointmentId = appt.id;
      patientId = appt.patientId;
    }
    if (input.encounterId) {
      const enc = await this.db.tx().encounter.findUnique({
        where: { id: input.encounterId },
        select: { patientId: true, appointmentId: true },
      });
      if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
      if (patientId && patientId !== enc.patientId) {
        throw new AppError('VALIDATION_FAILED', 'Booking dan kunjungan milik pasien berbeda', 400);
      }
      patientId = enc.patientId;
      appointmentId ??= enc.appointmentId;
    }
    const id = await this.repo.createTicket({
      serviceId: service.id,
      serviceDate: today(),
      source: 'loket',
      appointmentId,
      patientId,
    });
    if (input.encounterId) {
      // Kunjungan memakai tiket ini (nomor dipanggil di layanannya).
      await this.db.tx().encounter.update({ where: { id: input.encounterId }, data: { queueTicketId: id } });
    }
    const ticket = await this.loadTicket(id);
    if (patientId) {
      this.db.audit({
        action: 'create',
        resourceType: 'queue_ticket',
        resourceId: id,
        patientId,
        details: { serviceCode: service.code, source: 'loket' },
      });
    }
    return ticket;
  }

  /**
   * Tautkan tiket walk-in (mis. tiket loket dari anjungan) ke booking setelah pasien terdaftar. Untuk alur
   * registrasi (potongan 5a): task 1–2 tiket ini diisi mesin task ID saat event berikutnya (mis. terdaftar → 3).
   */
  async attachAppointment(ticketId: string, appointmentId: string): Promise<void> {
    if (!(await this.repo.lockTicket(ticketId)))
      throw new AppError('NOT_FOUND', 'Tiket tidak ditemukan', 404);
    const ticket = await this.repo.ticket(ticketId);
    const appt = await this.repo.appointment(appointmentId);
    if (!ticket || !appt) throw frontOfficeError('BOOKING_NOT_FOUND');
    if (ticket.appointmentId && ticket.appointmentId !== appointmentId) {
      throw frontOfficeError('TICKET_STATE_INVALID', undefined, 'Tiket sudah tertaut ke booking lain');
    }
    if (ticket.patientId && ticket.patientId !== appt.patientId) {
      throw frontOfficeError('TICKET_STATE_INVALID', undefined, 'Tiket milik pasien lain');
    }
    await this.repo.attachAppointment(ticketId, appointmentId, appt.patientId);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Panggilan dan transisi
  // ------------------------------------------------------------------------------------------------------------

  /** Panggil berikutnya (FIFO, nomor cadangan booking dilewati). Kosong → 409 `QUEUE_EMPTY`. */
  async callNext(serviceId: string, input: CallTicketInput) {
    await this.accessibleService(serviceId);
    const id = await this.repo.lockNextWaiting(serviceId, today());
    if (!id) throw frontOfficeError('QUEUE_EMPTY');
    return this.transition(id, 'call', input.counter);
  }

  /** Panggil tiket tertentu (mis. nomor cadangan booking di poli): menunggu/dilewati → dipanggil. */
  async callTicket(ticketId: string, input: CallTicketInput) {
    return this.act(ticketId, 'call', input.counter);
  }

  recall(ticketId: string, input: CallTicketInput) {
    return this.act(ticketId, 'recall', input.counter);
  }

  skip(ticketId: string, reason?: string) {
    return this.act(ticketId, 'skip', null, reason);
  }

  start(ticketId: string) {
    return this.act(ticketId, 'start', null);
  }

  finish(ticketId: string) {
    return this.act(ticketId, 'finish', null);
  }

  private async act(ticketId: string, action: QueueCallAction, counter: string | null, reason?: string) {
    if (!(await this.repo.lockTicket(ticketId)))
      throw new AppError('NOT_FOUND', 'Tiket tidak ditemukan', 404);
    const ticket = await this.repo.ticket(ticketId);
    if (!ticket) throw new AppError('NOT_FOUND', 'Tiket tidak ditemukan', 404);
    await this.assertServiceAccess(ticket.service);
    return this.transition(ticketId, action, counter, reason, ticket);
  }

  /** Tiket sudah terkunci. Catat panggilan, ubah status, audit (bila bertaut pasien), dan terbitkan event. */
  private async transition(
    ticketId: string,
    requested: QueueCallAction,
    counter: string | null,
    reason?: string,
    loaded?: TicketRow,
  ) {
    const ticket = loaded ?? (await this.repo.ticket(ticketId));
    if (!ticket) throw new AppError('NOT_FOUND', 'Tiket tidak ditemukan', 404);
    const status = ticket.status as QueueTicketStatus;
    const everCalled = ticket.calls.some((c) => c.action === 'call' || c.action === 'recall');
    // "Panggil" tiket yang pernah dipanggil = panggil ulang (bukan task BPJS baru).
    const action: QueueCallAction = requested === 'call' && everCalled ? 'recall' : requested;
    const allowed = requested === 'call' ? ['waiting', 'skipped'] : FROM[requested as keyof typeof FROM];
    if (!allowed.includes(status)) {
      throw frontOfficeError('TICKET_STATE_INVALID', { status, action: requested });
    }
    // Mulai/selesai tercatat di loket/ruang terakhir yang memanggil.
    const place = counter ?? (action === 'start' || action === 'finish' ? lastCounter(ticket.calls) : null);
    const call = await this.repo.insertCall(ticketId, action, place);
    await this.repo.setStatus(ticketId, TO[action]);

    if (ticket.patientId) {
      this.db.audit({
        action: 'update',
        resourceType: 'queue_ticket',
        resourceId: ticketId,
        patientId: ticket.patientId,
        reason: reason ?? null,
        details: { queueAction: action, serviceCode: ticket.service.code },
      });
    }
    const base = {
      ticketId,
      queueServiceId: ticket.serviceId,
      serviceKind: ticket.service.kind as QueueServiceKind,
      appointmentId: ticket.appointmentId,
      encounterId: ticket.encounters[0]?.id ?? null,
    };
    if (action === 'call' || action === 'recall') {
      await this.events.publish('queue.ticket_called', {
        ...base,
        callId: call.id,
        recall: action === 'recall',
      });
    } else if (action === 'start') {
      await this.events.publish('queue.ticket_started', base);
    } else if (action === 'finish') {
      await this.events.publish('queue.ticket_finished', base);
    }
    return { ticket: await this.loadTicket(ticketId), call: toCallRecord(call, ticket) };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Display
  // ------------------------------------------------------------------------------------------------------------

  /** Daftar display + layanannya (urut posisi), untuk admin mengikat TV ke display. */
  async listDisplays(): Promise<QueueDisplay[]> {
    const rows = await this.repo.displays();
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      serviceIds: d.services.map((s) => s.serviceId),
      active: d.active,
    }));
  }

  /**
   * ADR-0027 · Display milik perangkat TV pemanggil (`registered_devices.queue_display_id`). TV hanya boleh membaca
   * display yang terikat padanya: belum terikat → 409, display lain → 403 (tercatat).
   */
  async assertDeviceDisplay(displayId: string): Promise<void> {
    const principal = this.db.actor().devicePrincipal;
    if (!principal) throw new AppError('FORBIDDEN', 'Hanya untuk perangkat display terdaftar', 403);
    const bound = await this.repo.deviceDisplayId(principal.id);
    if (!bound) throw new AppError('CONFLICT', 'Perangkat ini belum diikat ke display antrean', 409);
    if (bound !== displayId) {
      throw new AuditedDenial('Display ini bukan milik perangkat Anda', {
        resourceType: 'queue_display',
        resourceId: displayId,
        details: { boundDisplayId: bound },
      });
    }
  }

  /** Kode layanan display (untuk menyaring aliran SSE). 404 bila display tidak ada/nonaktif. */
  async displayServiceCodes(displayId: string): Promise<Set<string>> {
    const display = await this.repo.display(displayId);
    if (!display?.active) throw new AppError('NOT_FOUND', 'Display tidak ditemukan', 404);
    return new Set(display.services.map((s) => s.service.code));
  }

  /** Papan TV: maks. 4 poli pertama yang aktif, panggilan terakhir + riwayat, menunggu (FIFO) dan cadangan. */
  async board(displayId: string, now = new Date()): Promise<QueueBoard> {
    const display = await this.repo.display(displayId);
    if (!display?.active) throw new AppError('NOT_FOUND', 'Display tidak ditemukan', 404);
    const clinicsServices = display.services
      .map((s) => s.service)
      .filter((s) => s.kind === 'poli' && BOARD_POLI_CODE.test(s.code))
      .slice(0, BOARD_MAX_CLINICS);
    if (clinicsServices.length === 0) {
      throw new AppError('CONFLICT', 'Display belum punya layanan poli aktif', 409);
    }
    const date = isoDateJakarta(now);
    const ids = clinicsServices.map((s) => s.id);
    const [calls, sessions, ...tickets] = await Promise.all([
      this.repo.recentCalls(ids, date, 50),
      this.repo.sessionsToday(ids, date),
      ...ids.map((id) => this.repo.tickets(id, date)),
    ]);
    const clinics = clinicsServices.map((s, i) => {
      const list = tickets[i] ?? [];
      const latest = calls.find((c) => c.ticket.serviceId === s.id);
      const session = sessions.find((x) => x.serviceId === s.id);
      const current =
        latest && (latest.ticket.status === 'called' || latest.ticket.status === 'serving')
          ? latest.ticket.ticketNo
          : null;
      return {
        poliCode: s.code,
        poliName: s.name,
        room: s.room ?? s.name,
        doctorName: session?.practitioner.name ?? 'Belum ada jadwal praktik',
        current,
        waiting: list.filter((t) => t.status === 'waiting' && !t.reserved).map((t) => t.ticketNo),
        reserved: list.filter((t) => t.status === 'waiting' && t.reserved).map((t) => t.ticketNo),
        note: session?.note?.trim() || 'Sesuai jadwal',
        noteTone: 'normal' as const,
      };
    });
    const history = calls.map((c) => ({ queueNo: c.ticket.ticketNo, poliCode: c.ticket.service.code }));
    return {
      area: display.name,
      asOf: now.toISOString(),
      calling: history[0] ?? null,
      history: history.slice(1, 1 + BOARD_HISTORY),
      clinics,
      info: BOARD_INFO,
    };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Task ID BPJS
  // ------------------------------------------------------------------------------------------------------------

  async bpjsTasks(appointmentId: string): Promise<{ patientId: string; items: BpjsQueueTask[] }> {
    const appt = await this.repo.appointment(appointmentId);
    if (!appt) throw frontOfficeError('BOOKING_NOT_FOUND');
    const rows = await this.repo.bpjsTasks(appointmentId);
    return {
      patientId: appt.patientId,
      items: rows.map((r) => ({
        id: r.id,
        appointmentId: r.appointmentId,
        taskId: r.taskId as BpjsQueueTask['taskId'],
        at: r.occurredAt.toISOString(),
        sync: {
          status: r.status as BpjsSyncStatus,
          sentAt: iso(r.sentAt),
          error: r.lastErrorCode ? { code: r.lastErrorCode, message: errorLabel(r.lastErrorCode) } : null,
        },
      })),
    };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Bantuan
  // ------------------------------------------------------------------------------------------------------------

  private async accessibleService(id: string, opts: { active?: boolean } = {}): Promise<ServiceRow> {
    const service = await this.repo.service(id);
    if (!service || (opts.active && !service.active)) {
      throw new AppError('NOT_FOUND', 'Layanan antrean tidak ditemukan', 404);
    }
    await this.assertServiceAccess(service);
    return service;
  }

  /** Lingkup `unit`: hanya layanan milik unit sesi pengguna. Penolakan tercatat walau permintaan batal. */
  private async assertServiceAccess(service: Pick<ServiceRow, 'id' | 'unitId' | 'code'>): Promise<void> {
    if (this.db.permissionScope() !== 'unit') return;
    const unitId = this.db.actor().unitId;
    if (service.unitId && unitId && service.unitId === unitId) return;
    throw new AuditedDenial('Layanan antrean ini bukan milik unit Anda', {
      resourceType: 'queue_service',
      resourceId: service.id,
      details: { scope: 'unit', serviceCode: service.code },
    });
  }

  private async loadTicket(id: string): Promise<QueueTicket> {
    const row = await this.repo.ticket(id);
    if (!row) throw new AppError('NOT_FOUND', 'Tiket tidak ditemukan', 404);
    const [ticket] = await this.present([row]);
    return ticket as QueueTicket;
  }

  /** Baris → kontrak; estimasi panggil = posisi menunggu × rata-rata lama layanan (pengaturan RS). */
  private async present(rows: TicketRow[], now = new Date()): Promise<QueueTicket[]> {
    const avgMs = (await this.repo.avgServiceMinutes()) * 60_000;
    let position = 0;
    return rows.map((r) => {
      const calls = r.calls.filter((c) => c.action === 'call' || c.action === 'recall');
      const last = calls.at(-1);
      const waiting = r.status === 'waiting' && !r.reserved;
      const estimate = waiting ? new Date(now.getTime() + position++ * avgMs).toISOString() : null;
      return {
        id: r.id,
        serviceId: r.serviceId,
        serviceCode: r.service.code,
        queueNo: r.ticketNo,
        serviceDate: r.serviceDate.toISOString().slice(0, 10),
        status: r.status as QueueTicketStatus,
        source: r.source as QueueTicket['source'],
        reserved: r.reserved,
        appointmentId: r.appointmentId,
        encounterId: r.encounters[0]?.id ?? null,
        patientId: r.patientId,
        issuedAt: r.createdAt.toISOString(),
        calledAt: iso(last?.calledAt),
        callCount: calls.length,
        counter: last?.counter ?? null,
        startedAt: iso(r.calls.find((c) => c.action === 'start')?.calledAt),
        finishedAt: iso(r.calls.find((c) => c.action === 'finish')?.calledAt),
        estimatedCallAt: estimate,
      };
    });
  }
}

function today(): string {
  return isoDateJakarta(new Date());
}

function lastCounter(calls: CallRow[]): string | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c?.counter) return c.counter;
  }
  return null;
}

function toServiceView(s: ServiceRow): QueueServiceView {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    kind: s.kind as QueueServiceKind,
    unitId: s.unitId,
    room: s.room,
    floor: s.floor,
    active: s.active,
  };
}

function toCallRecord(call: CallRow, ticket: TicketRow): QueueCallRecord {
  return {
    id: call.id,
    ticketId: call.ticketId,
    serviceCode: ticket.service.code,
    queueNo: ticket.ticketNo,
    action: call.action as QueueCallAction,
    counter: call.counter,
    at: call.calledAt.toISOString(),
    calledBy: call.calledBy,
  };
}

/** Label kode BPJS untuk petugas; kode lain (mis. galat outbox) tampil apa adanya. */
function errorLabel(code: string): string {
  return (bpjsErrorLabel(code as BpjsErrorCode) as string | undefined) ?? code;
}
