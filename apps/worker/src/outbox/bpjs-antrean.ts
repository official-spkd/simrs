import {
  ANTREAN_ENDPOINTS,
  ANTREAN_TASK_BATAL,
  type AntreanUpdateWaktuRequest,
  BPJS_ANTREAN_UPDATEWAKTU_OPERATION,
  FRONT_OFFICE_OPERATIONS,
} from '@simrs/shared';
import { defineBpjsOperation } from './bpjs-operation';
import { PermanentOperationError } from './operation-types';

const payloadSchema = FRONT_OFFICE_OPERATIONS[BPJS_ANTREAN_UPDATEWAKTU_OPERATION].payload;

function readPayload(payload: unknown) {
  const p = payloadSchema.safeParse(payload);
  if (!p.success) throw new PermanentOperationError('Payload task antrean tidak dikenali');
  return p.data;
}

/** Ulang setelah ini bila task sebelumnya belum punya pesan outbox (seharusnya tidak terjadi). */
const ORPHAN_RECHECK_MS = 5_000;
/** Status yang masih menunggu jawaban BPJS (`dead` = dikirim ulang setelah DLQ). */
const OPEN = ['pending', 'dead'];

/** Galat outbox → kode tersimpan di `bpjs_queue_tasks.last_error_code` (tanpa teks bebas). */
function errorCode(lastError: string | null): string {
  return /^(BPJS_[A-Z_]+)/.exec(lastError ?? '')?.[1] ?? 'OUTBOX_DEAD';
}

/**
 * F04 · `bpjs.antrean.updatewaktu`: kirim waktu task ID (milidetik epoch = waktu event) ke Antrean BPJS.
 * - Payload hanya ID baris `bpjs_queue_tasks`; kode booking dan waktu dibaca saat dikirim.
 * - Urutan per booking: task menunggu (`defer.afterMessageId`, tanpa menghabiskan percobaan) pesan task sebelumnya
 *   yang masih `pending`; 99 menunggu task tertinggi yang sudah ada. Task sebelumnya yang ditolak/DLQ tidak
 *   ditunggu (BPJS yang memutuskan; penolakannya tercatat).
 * - `dead` (DLQ) boleh dikirim ulang manual; terkirim/ditolak final (dilewati).
 * - Diterima → `sent`; ditolak → `rejected` + kode (`BPJS_TASK_GANDA` = sudah tercatat di BPJS, mis. ulang setelah
 *   timeout → `sent`); DLQ (akhir hari layanan WIB) → `dead` + kode.
 */
export const bpjsAntreanUpdateWaktu = defineBpjsOperation({
  async prepare(msg, ctx) {
    const { queueTaskId } = readPayload(msg.payload);
    const task = await ctx.read((tx) =>
      tx.bpjsQueueTask.findUnique({
        where: { id: queueTaskId },
        select: {
          appointmentId: true,
          taskId: true,
          occurredAt: true,
          status: true,
          appointment: { select: { bookingCode: true } },
        },
      }),
    );
    if (!task) return { skip: 'task antrean tidak ditemukan' };
    // `dead` boleh dikirim lagi (kirim ulang manual dari DLQ); terkirim/ditolak sudah final.
    if (task.status === 'sent' || task.status === 'rejected') return { skip: `task sudah ${task.status}` };

    const before = await ctx.read((tx) =>
      tx.bpjsQueueTask.findFirst({
        where: {
          appointmentId: task.appointmentId,
          taskId: task.taskId === ANTREAN_TASK_BATAL ? { not: ANTREAN_TASK_BATAL } : { lt: task.taskId },
        },
        orderBy: { taskId: 'desc' },
        select: { taskId: true, status: true, outboxMessageId: true },
      }),
    );
    if (before?.status === 'pending') {
      const reason = `menunggu task ${before.taskId}`;
      return before.outboxMessageId
        ? { defer: { afterMessageId: before.outboxMessageId, reason } }
        : { defer: { untilMs: Date.now() + ORPHAN_RECHECK_MS, reason } };
    }

    const body: AntreanUpdateWaktuRequest = {
      kodebooking: task.appointment.bookingCode,
      taskid: task.taskId as AntreanUpdateWaktuRequest['taskid'],
      waktu: task.occurredAt.getTime(),
    };
    return { service: 'antrean', ...ANTREAN_ENDPOINTS.updateWaktu, body };
  },

  async onAccepted(tx, msg) {
    const { queueTaskId } = readPayload(msg.payload);
    await tx.bpjsQueueTask.updateMany({
      where: { id: queueTaskId, status: { in: OPEN } },
      data: { status: 'sent', sentAt: new Date(), lastErrorCode: null },
    });
  },

  async onRejected(tx, msg, rejection) {
    const { queueTaskId } = readPayload(msg.payload);
    const already = rejection.code === 'BPJS_TASK_GANDA';
    await tx.bpjsQueueTask.updateMany({
      where: { id: queueTaskId, status: { in: OPEN } },
      data: already
        ? { status: 'sent', sentAt: new Date(), lastErrorCode: null }
        : { status: 'rejected', lastErrorCode: rejection.code },
    });
  },

  async onDead(tx, msg) {
    const p = payloadSchema.safeParse(msg.payload);
    if (!p.success) return;
    await tx.bpjsQueueTask.updateMany({
      where: { id: p.data.queueTaskId, status: 'pending' },
      data: { status: 'dead', lastErrorCode: errorCode(msg.lastError) },
    });
  },
});
