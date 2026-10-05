import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  AppError,
  type CdsAlertDecision,
  type CdsOverrideQuery,
  type CdsOverrideReport,
  type CpoeCdsLevel,
  type CpoeCdsRule,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/** Kursor opak: waktu keputusan + id baris terakhir halaman sebelumnya. */
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || typeof id !== 'string') throw new Error('kursor');
    return { at: date, id };
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Kursor halaman tidak valid', 400);
  }
}

/**
 * K09 · Laporan tinjauan override CDS (keputusan fase 3 no. 10): setiap temuan `block` yang dilewati dengan alasan
 * (atau kiriman yang ditolak CDS), untuk auditor mutu dan komite farmasi/PFT. Hanya lingkup seluruh RS (`order.read`
 * lingkup `all`); identitas pasien cukup RM. Pembacaan dicatat di jejak audit.
 */
@Injectable()
export class CdsReportService {
  constructor(private readonly db: TenantDb) {}

  async overrides(q: CdsOverrideQuery): Promise<CdsOverrideReport> {
    if (this.db.permissionScope() !== 'all') {
      throw new AppError('FORBIDDEN', 'Laporan override CDS hanya untuk peran berlingkup seluruh RS', 403);
    }
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (from > to) throw new AppError('VALIDATION_FAILED', 'Rentang waktu terbalik', 400);
    const where: Prisma.CdsAlertWhereInput = { decision: q.decision, decidedAt: { gte: from, lte: to } };
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.OR = [{ decidedAt: { lt: c.at } }, { decidedAt: c.at, id: { lt: c.id } }];
    }
    const rows = await this.db.tx().cdsAlert.findMany({
      where,
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: {
        patient: { select: { mrn: true } },
        decider: { select: { displayName: true } },
      },
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    this.db.audit({
      action: 'read',
      resourceType: 'cds_alert',
      details: { report: 'cds_overrides', decision: q.decision, count: page.length },
    });
    return {
      items: page.map((r) => ({
        id: r.id,
        encounterId: r.encounterId,
        patientId: r.patientId,
        mrn: r.patient.mrn,
        orderGroupId: r.orderGroupId,
        ruleCode: r.ruleCode,
        ruleVersion: r.ruleVersion,
        level: r.level as CpoeCdsLevel,
        rule: r.rule as CpoeCdsRule,
        message: r.message,
        decision: r.decision as CdsAlertDecision,
        overrideReason: r.overrideReason,
        decidedBy: { userId: r.decidedBy, nama: r.decider.displayName, peran: r.decidedRole },
        decidedAt: r.decidedAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.decidedAt, last.id) : null,
    };
  }
}
