import { Injectable } from '@nestjs/common';
import { AuditRepository } from './audit.repository';

export const auditListSchemaLimits = { defaultLimit: 50, maxLimit: 200 } as const;

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async verifyChain() {
    const r = await this.repo.verifyChain();
    return {
      intact: r.firstBrokenSeq === null,
      checked: r.checked,
      firstBrokenSeq: r.firstBrokenSeq === null ? null : r.firstBrokenSeq.toString(),
      verifiedAt: new Date().toISOString(),
    };
  }

  /** Paginasi kursor berbasis seq (terbaru dulu). bigint diserialisasi sebagai string. */
  async list(q: { cursor?: string; limit: number; patientId?: string; actorUserId?: string }) {
    const rows = await this.repo.list({
      beforeSeq: q.cursor ? BigInt(q.cursor) : undefined,
      limit: q.limit,
      patientId: q.patientId,
      actorUserId: q.actorUserId,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({ ...r, seq: r.seq.toString(), occurredAt: r.occurredAt.toISOString() })),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.seq.toString() ?? null) : null,
    };
  }
}
