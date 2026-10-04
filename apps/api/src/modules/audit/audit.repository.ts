import { Injectable } from '@nestjs/common';
import { verifyAuditChain } from '@simrs/db';
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

/** Jumlah per pengguna per tanggal WIB (dasar temuan anomali). */
export interface DayBucket {
  userId: string | null;
  role: string | null;
  day: string;
  n: number;
  last: Date;
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

/** Aksi yang menyentuh data pasien (dasar deteksi akses di luar jam dinas). */
const PATIENT_READ_ACTIONS = ['read', 'search', 'print', 'export'];
/**
 * Dasar temuan volume: membuka, mencetak, mengekspor rekam medis. Tampil di hasil pencarian (`search`) tidak
 * dihitung: satu pencarian memuat hingga 20 pasien, sehingga petugas pendaftaran akan selalu melewati ambang.
 */
const PATIENT_VOLUME_ACTIONS = ['read', 'print', 'export'];
const MAX_FINDINGS_PER_KIND = 50;

@Injectable()
export class AuditRepository {
  constructor(private readonly db: TenantDb) {}

  verifyChain() {
    return verifyAuditChain(this.db.tx());
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

  /** Lonjakan gagal login / akses ditolak per pengguna per hari (WIB). Pengguna tak dikenal = userId null. */
  bursts(action: 'login_failed' | 'access_denied', since: Date, threshold: number): Promise<DayBucket[]> {
    return this.db.tx().$queryRaw<DayBucket[]>`
      SELECT actor_user_id::text AS "userId", max(actor_role) AS role,
             to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
             count(*)::int AS n, max(occurred_at) AS last
      FROM audit_events
      WHERE action = ${action} AND occurred_at >= ${since}
      GROUP BY 1, 3
      HAVING count(*) >= ${threshold}
      ORDER BY last DESC
      LIMIT ${MAX_FINDINGS_PER_KIND}`;
  }

  /**
   * Pengguna yang membuka data pasien di jam malam (WIB) di luar peran jaga 24 jam. Jendela [start, end) dalam
   * menit sejak tengah malam; bila start > end jendela melewati tengah malam (mis. 22:00–05:00).
   */
  nightAccess(
    since: Date,
    startMin: number,
    endMin: number,
    exemptRoles: readonly string[],
  ): Promise<DayBucket[]> {
    return this.db.tx().$queryRaw<DayBucket[]>`
      WITH e AS (
        SELECT actor_user_id, actor_role, patient_id, occurred_at,
               EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Jakarta') * 60
                 + EXTRACT(MINUTE FROM occurred_at AT TIME ZONE 'Asia/Jakarta') AS m
        FROM audit_events
        WHERE patient_id IS NOT NULL AND actor_user_id IS NOT NULL
          AND action = ANY(${PATIENT_READ_ACTIONS}::text[])
          AND (actor_role IS NULL OR actor_role <> ALL(${[...exemptRoles]}::text[]))
          AND occurred_at >= ${since}
      )
      SELECT actor_user_id::text AS "userId", max(actor_role) AS role,
             to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
             count(DISTINCT patient_id)::int AS n, max(occurred_at) AS last
      FROM e
      WHERE CASE WHEN ${startMin}::int > ${endMin}::int THEN m >= ${startMin}::int OR m < ${endMin}::int
                 ELSE m >= ${startMin}::int AND m < ${endMin}::int END
      GROUP BY 1, 3
      ORDER BY last DESC
      LIMIT ${MAX_FINDINGS_PER_KIND}`;
  }

  /** Pengguna yang membuka data pasien berbeda melebihi batas dalam satu hari (WIB). */
  patientVolume(since: Date, threshold: number): Promise<DayBucket[]> {
    return this.db.tx().$queryRaw<DayBucket[]>`
      SELECT actor_user_id::text AS "userId", max(actor_role) AS role,
             to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
             count(DISTINCT patient_id)::int AS n, max(occurred_at) AS last
      FROM audit_events
      WHERE patient_id IS NOT NULL AND actor_user_id IS NOT NULL
        AND action = ANY(${PATIENT_VOLUME_ACTIONS}::text[])
        AND occurred_at >= ${since}
      GROUP BY 1, 3
      HAVING count(DISTINCT patient_id) >= ${threshold}
      ORDER BY last DESC
      LIMIT ${MAX_FINDINGS_PER_KIND}`;
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

  pendingBreakGlass(since: Date) {
    return this.db.tx().breakGlassGrant.findMany({
      where: { reviewOutcome: null, grantedAt: { gte: since } },
      orderBy: { grantedAt: 'desc' },
      take: MAX_FINDINGS_PER_KIND,
      select: {
        id: true,
        grantedAt: true,
        user: { select: { id: true, displayName: true } },
      },
    });
  }
}
