import { Injectable } from '@nestjs/common';
import {
  AUDIT_MAX_FINDINGS_PER_KIND,
  auditAnomalyBuckets,
  type AuditAnomalySettings,
  readAuditAnomalySettings,
  verifyAuditTrail,
} from '@simrs/db';
import type { AuditVerifyMode } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

export interface AuditFilter {
  patientId?: string;
  actorUserId?: string;
  actorRole?: string;
  actions?: readonly string[];
  /** Rentang waktu catat server: [from, to). */
  from?: Date;
  to?: Date;
  outcome?: string;
}

export interface AuditListQuery extends AuditFilter {
  /** seq terakhir dari halaman sebelumnya (kursor, urut terbaru dulu). */
  beforeSeq?: bigint;
  limit: number;
}

const EVENT_SELECT = {
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
  ip: true,
  userAgent: true,
  details: true,
  hash: true,
} as const;

/** Batas pengaman riwayat tinjauan per temuan (dalam praktik hanya beberapa keputusan). */
const MAX_REVIEW_HISTORY = 100;

@Injectable()
export class AuditRepository {
  constructor(private readonly db: TenantDb) {}

  /** Keutuhan rantai + jangkar (ADR-0072); kunci jangkar dari env, bukan dari database. */
  verifyTrail(mode: AuditVerifyMode, anchorKeyB64: string | undefined) {
    return verifyAuditTrail(this.db.tx(), { tenantId: this.db.tenantId(), anchorKeyB64, mode });
  }

  private where(f: AuditFilter) {
    return {
      ...(f.patientId ? { patientId: f.patientId } : {}),
      ...(f.actorUserId ? { actorUserId: f.actorUserId } : {}),
      ...(f.actorRole ? { actorRole: f.actorRole } : {}),
      ...(f.actions?.length ? { action: { in: [...f.actions] } } : {}),
      ...(f.outcome ? { outcome: f.outcome } : {}),
      ...(f.from || f.to
        ? { occurredAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } }
        : {}),
    };
  }

  list(q: AuditListQuery) {
    return this.db.tx().auditEvent.findMany({
      where: {
        ...this.where(q),
        ...(q.beforeSeq !== undefined ? { seq: { lt: q.beforeSeq } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: q.limit + 1,
      select: EVENT_SELECT,
    });
  }

  findBySeq(seq: bigint) {
    return this.db.tx().auditEvent.findUnique({
      where: { tenantId_seq: { tenantId: this.db.tenantId(), seq } },
      select: { ...EVENT_SELECT, prevHash: true },
    });
  }

  /** Untuk ekspor: urut seq naik (rantai bisa diperiksa ulang dari berkas), maksimal `max + 1` baris. */
  forExport(f: AuditFilter, max: number) {
    return this.db.tx().auditEvent.findMany({
      where: this.where(f),
      orderBy: { seq: 'asc' },
      take: max + 1,
      select: { ...EVENT_SELECT, prevHash: true },
    });
  }

  /** Versi isian hasil koreksi + versi yang digantikannya (diff di detail audit, P07). */
  formCorrection(id: string) {
    return this.db.tx().formResponse.findUnique({
      where: { id },
      select: {
        id: true,
        rootId: true,
        patientId: true,
        formCode: true,
        version: true,
        status: true,
        answers: true,
        correctionReason: true,
        createdBy: true,
        createdAt: true,
        definition: { select: { title: true, version: true, schema: true } },
        supersedes: { select: { version: true, answers: true } },
      },
    });
  }

  formRoot(id: string) {
    return this.db.tx().formResponse.findUnique({
      where: { id },
      select: { createdBy: true, createdAt: true },
    });
  }

  users(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.tx().user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, username: true },
    });
  }

  anomalySettings(): Promise<AuditAnomalySettings> {
    return readAuditAnomalySettings(this.db.tx());
  }

  /**
   * Dasar temuan per jenis sejak `since`: hari lampau dari ringkasan harian (bila ada, parameter sama), hari ini
   * dan hari tanpa ringkasan dihitung langsung (ADR-0072). Hasil sama dengan agregasi langsung seluruh jendela.
   */
  anomalyBuckets(since: Date, settings: AuditAnomalySettings) {
    return auditAnomalyBuckets(this.db.tx(), { since, settings, limit: AUDIT_MAX_FINDINGS_PER_KIND });
  }

  /** Keputusan tinjauan anomali (entri audit `review`), terbaru dulu. */
  anomalyReviews(keys: string[]) {
    if (keys.length === 0) return Promise.resolve([]);
    return this.db.tx().auditEvent.findMany({
      where: { action: 'review', resourceType: 'audit_anomaly', resourceId: { in: keys } },
      orderBy: { seq: 'desc' },
      select: { resourceId: true, details: true, reason: true, actorUserId: true, occurredAt: true },
    });
  }

  /** Riwayat tinjauan satu temuan (entri audit `review`), terbaru dulu. */
  anomalyReviewHistory(key: string) {
    return this.db.tx().auditEvent.findMany({
      where: { action: 'review', resourceType: 'audit_anomaly', resourceId: key },
      orderBy: { seq: 'desc' },
      take: MAX_REVIEW_HISTORY,
      select: {
        seq: true,
        details: true,
        reason: true,
        actorUserId: true,
        actorRole: true,
        occurredAt: true,
      },
    });
  }

  pendingBreakGlass(since: Date) {
    return this.db.tx().breakGlassGrant.findMany({
      where: { reviewOutcome: null, grantedAt: { gte: since } },
      orderBy: { grantedAt: 'desc' },
      take: AUDIT_MAX_FINDINGS_PER_KIND,
      select: {
        id: true,
        grantedAt: true,
        user: { select: { id: true, displayName: true } },
      },
    });
  }
}
