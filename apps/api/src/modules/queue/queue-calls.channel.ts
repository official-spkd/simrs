import type { TenantTx } from '@simrs/db';
import { isUuid, QUEUE_NOTIFY_CHANNEL, QUEUE_SSE_EVENTS, type QueueDisplayEvent } from '@simrs/shared';
import type { SseChannel, SseEvent } from '../../infra/realtime/sse.service';

type CallEvent = Extract<QueueDisplayEvent, { type: 'call' }>;

const select = {
  id: true,
  action: true,
  counter: true,
  calledAt: true,
  ticket: { select: { ticketNo: true, service: { select: { code: true } } } },
} as const;

type Row = {
  id: string;
  action: string;
  counter: string | null;
  calledAt: Date;
  ticket: { ticketNo: string; service: { code: string } };
};

/** Hanya panggilan (`call`/`recall`) dengan tujuan yang disiarkan ke TV; aksi lain tidak pernah keluar. */
function toEvent(row: Row): SseEvent<CallEvent> | null {
  if ((row.action !== 'call' && row.action !== 'recall') || !row.counter) return null;
  return {
    id: row.id,
    event: QUEUE_SSE_EVENTS.call,
    data: {
      type: 'call',
      callId: row.id,
      queueNo: row.ticket.ticketNo,
      serviceCode: row.ticket.service.code,
      counter: row.counter,
      recall: row.action === 'recall',
      at: row.calledAt.toISOString(),
    },
  };
}

/**
 * ADR-0026 · Aliran SSE panggilan antrean: kanal `queue_calls` (trigger `app_notify_row`, payload tenant + id). Isi
 * event tanpa PHI (nomor, kode layanan, tujuan). Id event = id baris (UUID v7, terurut) sehingga `Last-Event-ID`
 * memutar ulang panggilan setelahnya. Penyaringan per display (kode layanan) dilakukan di handler.
 */
export const queueCallsChannel: SseChannel<CallEvent> = {
  name: QUEUE_NOTIFY_CHANNEL,
  async load(tx: TenantTx, id: string) {
    const row = await tx.queueCall.findUnique({ where: { id }, select });
    return row ? toEvent(row) : null;
  },
  async replay(tx: TenantTx, afterId: string, limit: number) {
    // Last-Event-ID bukan id panggilan (mis. dari aliran lain): tidak ada yang bisa diputar ulang.
    if (!isUuid(afterId)) return [];
    const rows = await tx.queueCall.findMany({
      where: { id: { gt: afterId }, action: { in: ['call', 'recall'] } },
      orderBy: { id: 'asc' },
      take: limit,
      select,
    });
    return rows.flatMap((r) => {
      const e = toEvent(r);
      return e ? [e] : [];
    });
  },
};
