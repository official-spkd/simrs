import { Injectable } from '@nestjs/common';
import { enqueueOutbox } from '@simrs/db';
import { AppError, type IntegrationTarget, newId } from '@simrs/shared';
import { PrismaService } from '../../infra/prisma.service';

export interface TenantView {
  id: string;
  code: string;
  name: string;
  kemenkesCode: string | null;
  bpjsPpkCode: string | null;
  satusehatOrgId: string | null;
  hospitalClass: string | null;
  status: string;
}

@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant aktif sesuai konteks. RLS menjamin hanya baris tenant itu sendiri yang terlihat. */
  async current(tenantId: string): Promise<TenantView> {
    const t = await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    if (!t) throw new AppError('NOT_FOUND', 'Tenant tidak ditemukan', 404);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      kemenkesCode: t.kemenkesCode,
      bpjsPpkCode: t.bpjsPpkCode,
      satusehatOrgId: t.satusehatOrgId,
      hospitalClass: t.hospitalClass,
      status: t.status,
    };
  }

  /** Pesan outbox contoh (fase 0) untuk membuktikan alur API → outbox → worker → mock. */
  async enqueuePing(tenantId: string, target: IntegrationTarget) {
    const idempotencyKey = `ping-${newId()}`;
    const msg = await this.prisma.forTenant(tenantId, (tx) =>
      enqueueOutbox(tx, tenantId, {
        target,
        operation: 'ping',
        idempotencyKey,
        payload: { note: 'contoh fase 0' },
      }),
    );
    return { id: msg.id, target: msg.target, idempotencyKey: msg.idempotencyKey, status: msg.status };
  }

  async outboxStatus(tenantId: string, id: string) {
    const msg = await this.prisma.forTenant(tenantId, (tx) =>
      tx.outboxMessage.findUnique({
        where: { id },
        include: { deliveries: { orderBy: { attemptNo: 'asc' } } },
      }),
    );
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
