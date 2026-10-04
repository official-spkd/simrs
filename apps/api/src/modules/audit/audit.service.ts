import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  diffAnswers,
  type FormAnswers,
  formSchemaSchema,
  AUDIT_ACTION_GROUPS,
  AUDIT_ANOMALY_KEY,
  AUDIT_REVIEW_OUTCOMES,
  type AuditActionGroup,
  type AuditAnomalyReviewEntry,
  type AuditAnomalyReviewInput,
  type AuditReviewOutcome,
  AppError,
  formatTanggal,
  formatTanggalWaktu,
  NIGHT_SHIFT_ROLES,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { type AuditFilter, AuditRepository, type DayBucket } from './audit.repository';

export const auditListSchemaLimits = { defaultLimit: 50, maxLimit: 200 } as const;

const DAY = 86_400_000;
/** Ekspor dibatasi agar satu permintaan tidak membebani server; persempit rentang bila lebih. */
export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_MAX_DAYS = 92;

export interface AuditQuery {
  patientId?: string;
  actorUserId?: string;
  actorRole?: string;
  group?: AuditActionGroup;
  from?: string;
  to?: string;
  outcome?: string;
}

type Severity = 'tinggi' | 'sedang';

export interface AnomalyFinding {
  key: string;
  kind: 'break_glass' | 'login_failed' | 'access_denied' | 'night' | 'volume';
  severity: Severity;
  title: string;
  description: string;
  actor: { id: string; displayName: string } | null;
  count: number;
  lastAt: string;
  /** Akses darurat: id izin (ditinjau lewat /authz/break-glass/:id/review). */
  grantId: string | null;
  /** Keputusan yang berlaku (tinjauan terbaru); riwayat lengkap lewat `anomalyReviewHistory`. */
  review: {
    outcome: AuditReviewOutcome;
    note: string | null;
    reviewedAt: string;
    reviewerId: string | null;
    reviewer: { id: string; displayName: string } | null;
  } | null;
}

function toFilter(q: AuditQuery): AuditFilter {
  return {
    patientId: q.patientId,
    actorUserId: q.actorUserId,
    actorRole: q.actorRole,
    actions: q.group ? AUDIT_ACTION_GROUPS[q.group].actions : undefined,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    outcome: q.outcome,
  };
}

const minutes = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};
const dayLabel = (day: string) => formatTanggal(`${day}T12:00:00+07:00`);

/** Keputusan dari entri audit `review` (`details.outcome`); entri tanpa keputusan yang dikenal diabaikan. */
function reviewOutcome(details: unknown): AuditReviewOutcome | null {
  const outcome = (details as { outcome?: unknown } | null)?.outcome;
  return AUDIT_REVIEW_OUTCOMES.find((o) => o === outcome) ?? null;
}

/** Sel CSV aman: diapit kutip, dan nilai yang bisa dieksekusi spreadsheet (=, +, -, @) diberi awalan '. */
export function csvCell(value: unknown): string {
  const s =
    value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly db: TenantDb,
  ) {}

  async verifyChain() {
    const r = await this.repo.verifyChain();
    return {
      intact: r.firstBrokenSeq === null,
      checked: r.checked,
      firstBrokenSeq: r.firstBrokenSeq === null ? null : r.firstBrokenSeq.toString(),
      verifiedAt: new Date().toISOString(),
    };
  }

  private async actorMap(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = await this.repo.users(unique);
    return new Map(rows.map((u) => [u.id, u]));
  }

  /** Paginasi kursor berbasis seq (terbaru dulu), dengan nama pelaku. bigint diserialisasi sebagai string. */
  async list(q: AuditQuery & { cursor?: string; limit: number }) {
    const rows = await this.repo.list({
      ...toFilter(q),
      beforeSeq: q.cursor ? BigInt(q.cursor) : undefined,
      limit: q.limit,
    });
    const page = rows.slice(0, q.limit);
    const actors = await this.actorMap(page.map((r) => r.actorUserId));
    return {
      items: page.map((r) => ({
        ...r,
        seq: r.seq.toString(),
        occurredAt: r.occurredAt.toISOString(),
        actor: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null,
      })),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.seq.toString() ?? null) : null,
    };
  }

  async detail(seq: string) {
    const r = await this.repo.findBySeq(BigInt(seq));
    if (!r) throw new AppError('NOT_FOUND', 'Entri audit tidak ditemukan', 404);
    const actors = await this.actorMap([r.actorUserId]);
    const change =
      r.resourceType === 'form_response' && r.action === 'correct' && r.resourceId
        ? await this.formChange(r.resourceId)
        : null;
    return {
      ...r,
      seq: r.seq.toString(),
      occurredAt: r.occurredAt.toISOString(),
      actor: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null,
      change,
    };
  }

  /**
   * Detail koreksi isian formulir (P07, mockup Audit "Versi 1 → versi 2"): alasan, penulis asli, pengoreksi, dan
   * nilai yang berubah. Isinya data klinis, jadi pembukaannya dicatat dengan patientId.
   */
  private async formChange(responseId: string) {
    const fr = await this.repo.formCorrection(responseId);
    if (!fr?.supersedes) return null;
    const root = await this.repo.formRoot(fr.rootId);
    const people = await this.actorMap([root?.createdBy ?? null, fr.createdBy]);
    const name = (id: string | null | undefined) => (id ? (people.get(id)?.displayName ?? null) : null);
    const schema = formSchemaSchema.parse(fr.definition.schema);
    this.db.audit({
      action: 'read',
      resourceType: 'form_response',
      resourceId: fr.id,
      patientId: fr.patientId,
      details: { via: 'audit' },
    });
    return {
      formCode: fr.formCode,
      formTitle: fr.definition.title,
      formVersion: fr.definition.version,
      fromVersion: fr.supersedes.version,
      toVersion: fr.version,
      status: fr.status,
      reason: fr.correctionReason,
      originalAuthor: name(root?.createdBy),
      originalAt: root?.createdAt.toISOString() ?? null,
      correctedBy: name(fr.createdBy),
      correctedAt: fr.createdAt.toISOString(),
      rows: diffAnswers(schema, fr.supersedes.answers as FormAnswers, fr.answers as FormAnswers),
    };
  }

  /**
   * Temuan anomali dalam `days` hari terakhir, dihitung dari jejak audit + izin akses darurat. Ambang mengikuti
   * pengaturan RS (P12): `audit.night_hours`, `audit.volume_threshold`, `audit.burst_threshold`.
   */
  async anomalies(days: number) {
    const tx = this.db.tx();
    const since = new Date(Date.now() - days * DAY);
    const night = await readTenantSetting(tx, 'audit.night_hours');
    const volumeThreshold = await readTenantSetting(tx, 'audit.volume_threshold');
    const burstThreshold = await readTenantSetting(tx, 'audit.burst_threshold');

    const grants = await this.repo.pendingBreakGlass(since);
    const buckets: Array<{ kind: Exclude<AnomalyFinding['kind'], 'break_glass'>; b: DayBucket }> = [
      ...(await this.repo.bursts('login_failed', since, burstThreshold)).map((b) => ({
        kind: 'login_failed' as const,
        b,
      })),
      ...(await this.repo.bursts('access_denied', since, burstThreshold)).map((b) => ({
        kind: 'access_denied' as const,
        b,
      })),
      ...(
        await this.repo.nightAccess(since, minutes(night.start), minutes(night.end), NIGHT_SHIFT_ROLES)
      ).map((b) => ({ kind: 'night' as const, b })),
      ...(await this.repo.patientVolume(since, volumeThreshold)).map((b) => ({ kind: 'volume' as const, b })),
    ];
    const keys = buckets.map(({ kind, b }) => `${kind}:${b.userId ?? '-'}:${b.day}`);
    // Tinjauan terbaru per kunci yang berlaku (aturan yang sama dengan riwayat tinjauan).
    const reviews = new Map<
      string,
      { outcome: AuditReviewOutcome; reason: string | null; actorUserId: string | null; occurredAt: Date }
    >();
    for (const r of await this.repo.anomalyReviews(keys)) {
      const outcome = reviewOutcome(r.details);
      if (r.resourceId && outcome && !reviews.has(r.resourceId)) reviews.set(r.resourceId, { ...r, outcome });
    }
    const actors = await this.actorMap([
      ...buckets.map((x) => x.b.userId),
      ...[...reviews.values()].map((r) => r.actorUserId),
    ]);
    const person = (id: string | null) => {
      const a = id ? actors.get(id) : undefined;
      return a ? { id: a.id, displayName: a.displayName } : null;
    };

    const findings: AnomalyFinding[] = grants.map((g) => ({
      key: `break_glass:${g.id}`,
      kind: 'break_glass',
      severity: 'tinggi',
      title: 'Akses darurat belum ditinjau',
      description: `${g.user.displayName} membuka rekam medis lewat akses darurat, ${formatTanggalWaktu(g.grantedAt)}.`,
      actor: g.user,
      count: 1,
      lastAt: g.grantedAt.toISOString(),
      grantId: g.id,
      review: null,
    }));
    buckets.forEach(({ kind, b }, i) => {
      const key = keys[i] as string;
      const actor = person(b.userId);
      const who = actor?.displayName ?? 'Akun tidak dikenal';
      const when = dayLabel(b.day);
      const text: Record<typeof kind, { title: string; description: string; severity: Severity }> = {
        login_failed: {
          title: `${b.n}× gagal masuk dalam sehari`,
          description: `${who}, ${when}. Bisa salah sandi berulang atau upaya menebak sandi.`,
          severity: b.n >= burstThreshold * 2 ? 'tinggi' : 'sedang',
        },
        access_denied: {
          title: `${b.n}× akses ditolak`,
          description: `${who} mencoba membuka fitur di luar izinnya, ${when}.`,
          severity: 'sedang',
        },
        night: {
          title: 'Akses data pasien di luar jam dinas',
          description: `${who} membuka data ${b.n} pasien antara ${night.start} dan ${night.end} WIB, ${when}.`,
          severity: 'sedang',
        },
        volume: {
          title: `${b.n} pasien dibuka dalam sehari`,
          description: `${who} membuka data ${b.n} pasien berbeda, ${when} (batas ${volumeThreshold}).`,
          severity: 'tinggi',
        },
      };
      const r = reviews.get(key);
      findings.push({
        key,
        kind,
        ...text[kind],
        actor,
        count: b.n,
        lastAt: b.last.toISOString(),
        grantId: null,
        review: r
          ? {
              outcome: r.outcome,
              note: r.reason,
              reviewedAt: r.occurredAt.toISOString(),
              reviewerId: r.actorUserId,
              reviewer: person(r.actorUserId),
            }
          : null,
      });
    });
    findings.sort(
      (a, b) => Number(a.review !== null) - Number(b.review !== null) || b.lastAt.localeCompare(a.lastAt),
    );
    return { since: since.toISOString(), days, findings };
  }

  /**
   * Riwayat tinjauan satu temuan, terbaru dulu (MRMIK: keputusan lama tidak hilang). Keputusan terbaru berlaku,
   * sama dengan `anomalies`. Tanpa PHI: kunci temuan hanya berisi jenis, id pengguna, dan tanggal.
   */
  async anomalyReviewHistory(key: string): Promise<{ key: string; items: AuditAnomalyReviewEntry[] }> {
    const rows = (await this.repo.anomalyReviewHistory(key)).flatMap((r) => {
      const outcome = reviewOutcome(r.details);
      return outcome ? [{ ...r, outcome }] : [];
    });
    const people = await this.actorMap(rows.map((r) => r.actorUserId));
    return {
      key,
      items: rows.map((r, i) => {
        const who = r.actorUserId ? people.get(r.actorUserId) : undefined;
        return {
          seq: r.seq.toString(),
          outcome: r.outcome,
          note: r.reason,
          reviewedAt: r.occurredAt.toISOString(),
          reviewer: who ? { id: who.id, displayName: who.displayName } : null,
          reviewerRole: r.actorRole,
          effective: i === 0,
        };
      }),
    };
  }

  /**
   * Keputusan tinjauan anomali = entri audit `review` (append-only). Pelaku tidak boleh meninjau temuan tentang
   * dirinya sendiri. Tinjauan ulang menambah entri baru; yang terbaru berlaku.
   */
  reviewAnomaly(input: AuditAnomalyReviewInput) {
    const m = AUDIT_ANOMALY_KEY.exec(input.key);
    const subject = m?.[2];
    if (subject && subject === this.db.actorUserId()) {
      throw new AppError('CONFLICT', 'Tidak bisa meninjau temuan tentang akun sendiri', 409);
    }
    this.db.audit({
      action: 'review',
      resourceType: 'audit_anomaly',
      resourceId: input.key,
      reason: input.note ?? null,
      details: { outcome: input.outcome },
    });
    return { key: input.key, outcome: input.outcome, reviewedAt: new Date().toISOString() };
  }

  /** Paket bukti: CSV (UTF-8 + BOM agar terbaca Excel), urut seq naik dengan prev_hash/hash untuk verifikasi ulang. */
  async exportCsv(q: AuditQuery & { from: string; to: string }) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to <= from || to.getTime() - from.getTime() > EXPORT_MAX_DAYS * DAY) {
      throw new AppError('VALIDATION_FAILED', `Rentang ekspor harus 1 sampai ${EXPORT_MAX_DAYS} hari`, 400);
    }
    const rows = await this.repo.forExport(toFilter(q), EXPORT_MAX_ROWS);
    if (rows.length > EXPORT_MAX_ROWS) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Lebih dari ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} entri. Persempit rentang waktu atau filter.`,
        400,
      );
    }
    const actors = await this.actorMap(rows.map((r) => r.actorUserId));
    const header = [
      'seq',
      'waktu_server',
      'pelaku_id',
      'pelaku_nama',
      'peran',
      'aksi',
      'hasil',
      'sumber',
      'sumber_id',
      'pasien_id',
      'alasan',
      'ip',
      'request_id',
      'rincian',
      'prev_hash',
      'hash',
    ];
    const lines = rows.map((r) =>
      [
        r.seq.toString(),
        r.occurredAt.toISOString(),
        r.actorUserId,
        r.actorUserId ? actors.get(r.actorUserId)?.displayName : null,
        r.actorRole,
        r.action,
        r.outcome,
        r.resourceType,
        r.resourceId,
        r.patientId,
        r.reason,
        r.ip,
        r.requestId,
        r.details,
        r.prevHash,
        r.hash,
      ]
        .map(csvCell)
        .join(','),
    );
    this.db.audit({
      action: 'export',
      resourceType: 'audit_event',
      details: { count: rows.length, from: from.toISOString(), to: to.toISOString(), group: q.group ?? null },
    });
    return `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
  }
}
