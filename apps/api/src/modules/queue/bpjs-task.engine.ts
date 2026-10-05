import { Injectable, type OnModuleInit } from '@nestjs/common';
import { enqueueOutbox, type TenantTx } from '@simrs/db';
import {
  ANTREAN_TASK_BATAL,
  type AntreanTaskId,
  BPJS_ANTREAN_UPDATEWAKTU_OPERATION,
  bpjsTaskForEvent,
  type DomainEvent as SharedDomainEvent,
  type DomainEventName,
  FRONT_OFFICE_OPERATIONS,
  newId,
  outboxKey,
} from '@simrs/shared';
import type { DomainEvent, DomainEventContext } from '../../infra/events/domain-events';
import { DomainEvents } from '../../infra/events/domain-events';

/** Event yang bisa membentuk task ID (lihat `bpjsTaskForEvent` di `@simrs/shared`). */
export const BPJS_TASK_EVENTS = [
  'booking.checked_in',
  'booking.cancelled',
  'queue.ticket_called',
  'queue.ticket_started',
  'queue.ticket_finished',
  'encounter.registered',
  'encounter.cancelled',
] as const satisfies readonly DomainEventName[];

const LABEL = 'queue.bpjs-task-id';

/**
 * F04 · Mesin task ID Antrean BPJS (docs/06 §2, rencana fase 2 potongan 4a). Task dibentuk dari EVENT DOMAIN, bukan
 * dari tombol layar, di transaksi penerbit (ikut commit/batal bersama perubahan asalnya):
 * - `booking.checked_in` → 1, panggilan pertama tiket loket → 2, `encounter.registered` rawat jalan → 3,
 *   poli mulai/selesai → 4/5, batal → 99 (pemetaan `bpjsTaskForEvent`);
 * - hanya booking JKN (`appointments.quota_bucket = 'jkn'`); non-JKN tidak dikirim;
 * - satu baris per (booking, task) di `bpjs_queue_tasks`: waktu = waktu event (ms), tidak pernah ditimpa
 *   (task yang sudah ada diabaikan), dan tidak ada task baru setelah 99;
 * - walk-in: tiket loket yang kemudian tertaut ke booking mengisi task 1 (waktu ambil tiket) dan 2 (panggilan pertama)
 *   yang belum ada, sebelum task berikutnya dicatat, bila belum ada task yang lebih tinggi;
 * - tiap task baru → outbox `bpjs.antrean.updatewaktu` (payload ID baris). Worker menjaga urutan: task menunggu
 *   (`defer.afterMessageId`) pesan task sebelumnya yang belum terkirim.
 */
@Injectable()
export class BpjsTaskEngine implements OnModuleInit {
  constructor(private readonly events: DomainEvents) {}

  onModuleInit(): void {
    for (const name of BPJS_TASK_EVENTS) {
      this.events.on(name, (event, ctx) => this.handle(event as DomainEvent, ctx), { label: LABEL });
    }
  }

  async handle(event: DomainEvent, { tx, tenantId }: DomainEventContext): Promise<void> {
    const candidate = bpjsTaskForEvent({
      name: event.name,
      payload: event.payload,
      occurredAt: event.occurredAt,
    } as SharedDomainEvent);
    if (!candidate) return;
    await this.record(tx, tenantId, candidate.appointmentId, candidate.taskId, event.occurredAt);
  }

  /** Catat task (+ isian walk-in 1–2) untuk booking JKN. Kembalikan task yang benar-benar baru dicatat. */
  async record(
    tx: TenantTx,
    tenantId: string,
    appointmentId: string,
    taskId: AntreanTaskId,
    at: Date,
  ): Promise<AntreanTaskId[]> {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: { quotaBucket: true },
    });
    if (!appointment || appointment.quotaBucket !== 'jkn') return [];

    const existing = new Set(
      (await tx.bpjsQueueTask.findMany({ where: { appointmentId }, select: { taskId: true } })).map(
        (t) => t.taskId,
      ),
    );
    if (existing.has(ANTREAN_TASK_BATAL)) return [];
    const highest = Math.max(0, ...[...existing].filter((t) => t !== ANTREAN_TASK_BATAL));
    const created: AntreanTaskId[] = [];
    const insert = async (id: AntreanTaskId, when: Date) => {
      if (existing.has(id)) return;
      if (await this.insertTask(tx, tenantId, appointmentId, id, when)) {
        existing.add(id);
        created.push(id);
      }
    };

    if (taskId !== ANTREAN_TASK_BATAL && taskId >= 2 && highest < taskId) {
      const walkIn = await tx.queueTicket.findFirst({
        where: { appointmentId, service: { kind: 'loket' } },
        orderBy: { createdAt: 'asc' },
        select: {
          createdAt: true,
          calls: {
            where: { action: 'call' },
            orderBy: { calledAt: 'asc' },
            take: 1,
            select: { calledAt: true },
          },
        },
      });
      if (walkIn) {
        if (highest < 1 && walkIn.createdAt <= at) await insert(1, walkIn.createdAt);
        const firstCall = walkIn.calls[0]?.calledAt;
        if (taskId > 2 && highest < 2 && firstCall && firstCall <= at) await insert(2, firstCall);
      }
    }
    await insert(taskId, at);
    return created;
  }

  /** Sisip baris task bila belum ada (unik per booking + task) lalu antrekan pengirimannya. */
  private async insertTask(
    tx: TenantTx,
    tenantId: string,
    appointmentId: string,
    taskId: AntreanTaskId,
    at: Date,
  ): Promise<boolean> {
    const id = newId();
    const { count } = await tx.bpjsQueueTask.createMany({
      data: [{ id, tenantId, appointmentId, taskId, occurredAt: at }],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    const op = BPJS_ANTREAN_UPDATEWAKTU_OPERATION;
    const msg = await enqueueOutbox(tx, tenantId, {
      target: FRONT_OFFICE_OPERATIONS[op].target,
      operation: op,
      idempotencyKey: outboxKey(op, id),
      payload: { queueTaskId: id },
    });
    await tx.bpjsQueueTask.update({ where: { id }, data: { outboxMessageId: msg.id } });
    return true;
  }
}
