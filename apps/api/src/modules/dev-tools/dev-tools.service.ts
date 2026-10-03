import { Injectable } from '@nestjs/common';
import { AppError, type IntegrationTarget, newId } from '@simrs/shared';
import { OutboxRepository } from './outbox.repository';

export interface OutboxStatusView {
  id: string;
  target: string;
  operation: string;
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  deliveries: Array<{ attemptNo: number; outcome: string; statusCode: number | null; durationMs: number }>;
}

@Injectable()
export class DevToolsService {
  constructor(private readonly outbox: OutboxRepository) {}

  /** Pesan outbox contoh untuk membuktikan alur API → outbox → worker → mock. */
  async enqueuePing(tenantId: string, target: IntegrationTarget) {
    const msg = await this.outbox.enqueue(tenantId, {
      target,
      operation: 'ping',
      idempotencyKey: `ping-${newId()}`,
      payload: { note: 'contoh fase 0' },
    });
    return { id: msg.id, target: msg.target, idempotencyKey: msg.idempotencyKey, status: msg.status };
  }

  async outboxStatus(tenantId: string, id: string): Promise<OutboxStatusView> {
    const msg = await this.outbox.findWithDeliveries(tenantId, id);
    if (!msg) throw new AppError('NOT_FOUND', 'Pesan outbox tidak ditemukan', 404);
    return {
      id: msg.id,
      target: msg.target,
      operation: msg.operation,
      status: msg.status,
      attempts: msg.attempts,
      lastError: msg.lastError,
      nextAttemptAt: msg.nextAttemptAt.toISOString(),
      sentAt: msg.sentAt?.toISOString() ?? null,
      deliveries: msg.deliveries.map((d) => ({
        attemptNo: d.attemptNo,
        outcome: d.outcome,
        statusCode: d.statusCode,
        durationMs: d.durationMs,
      })),
    };
  }
}
