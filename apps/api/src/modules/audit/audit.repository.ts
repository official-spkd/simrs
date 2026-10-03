import { Injectable } from '@nestjs/common';
import { verifyAuditChain } from '@simrs/db';
import { TenantDb } from '../../infra/tenant-db';

export interface AuditListQuery {
  /** seq terakhir dari halaman sebelumnya (kursor, urut terbaru dulu). */
  beforeSeq?: bigint;
  limit: number;
  patientId?: string;
  actorUserId?: string;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly db: TenantDb) {}

  verifyChain() {
    return verifyAuditChain(this.db.tx());
  }

  list(q: AuditListQuery) {
    return this.db.tx().auditEvent.findMany({
      where: {
        ...(q.beforeSeq !== undefined ? { seq: { lt: q.beforeSeq } } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      },
      orderBy: { seq: 'desc' },
      take: q.limit + 1,
      select: {
        seq: true,
        occurredAt: true,
        actorUserId: true,
        actorRole: true,
        patientId: true,
        resourceType: true,
        resourceId: true,
        action: true,
        outcome: true,
        reason: true,
        requestId: true,
        details: true,
        hash: true,
      },
    });
  }
}
