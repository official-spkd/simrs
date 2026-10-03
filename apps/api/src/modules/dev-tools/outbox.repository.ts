import { Injectable } from '@nestjs/common';
import { enqueueOutbox } from '@simrs/db';
import type { OutboxEnvelope } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

@Injectable()
export class OutboxRepository {
  constructor(private readonly db: TenantDb) {}

  enqueue(envelope: OutboxEnvelope) {
    return enqueueOutbox(this.db.tx(), this.db.tenantId(), envelope);
  }

  findWithDeliveries(id: string) {
    return this.db.tx().outboxMessage.findUnique({
      where: { id },
      include: { deliveries: { orderBy: { attemptNo: 'asc' } } },
    });
  }
}
