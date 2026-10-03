import { Injectable } from '@nestjs/common';
import { enqueueOutbox } from '@simrs/db';
import type { OutboxEnvelope } from '@simrs/shared';
import { PrismaService } from '../../infra/prisma.service';

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  enqueue(tenantId: string, envelope: OutboxEnvelope) {
    return this.prisma.forTenant(tenantId, (tx) => enqueueOutbox(tx, tenantId, envelope));
  }

  findWithDeliveries(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.outboxMessage.findUnique({
        where: { id },
        include: { deliveries: { orderBy: { attemptNo: 'asc' } } },
      }),
    );
  }
}
