import { createHash } from 'node:crypto';
import {
  AUDIT_BURST_THRESHOLD_MIN,
  AUDIT_VOLUME_THRESHOLD_MIN,
  type AuditAnomalyKind,
  isoDateJakarta,
  newId,
  NIGHT_SHIFT_ROLES,
} from '@simrs/shared';
import type { TenantTx } from './client';
import { Prisma } from './generated/prisma/client';
import { readTenantSetting } from './platform';

/**
 * P04 · Dasar temuan anomali: hitungan per pengguna per tanggal WIB dari `audit_events` (ADR-0072).
 *
 * Satu implementasi SQL dipakai dua jalur: agregasi langsung (hari ini, atau hari yang belum diringkas) dan job
 * ringkasan harian (`audit_daily_summaries`). Layar Audit menggabungkan keduanya; hasilnya sama dengan agregasi
 * langsung atas seluruh jendela (dibuktikan tes `apps/api/test/audit-anchor.test.ts`).
 */

/** Aksi yang menyentuh data pasien (dasar deteksi akses di luar jam dinas). */
export const AUDIT_PATIENT_READ_ACTIONS = ['read', 'search', 'print', 'export'] as const;
/**
 * Dasar temuan volume: membuka, mencetak, mengekspor rekam medis. Tampil di hasil pencarian (`search`) tidak
 * dihitung: satu pencarian memuat hingga 20 pasien, sehingga petugas pendaftaran akan selalu melewati ambang.
 */
export const AUDIT_PATIENT_VOLUME_ACTIONS = ['read', 'print', 'export'] as const;
/** Batas temuan per jenis yang dikembalikan ke layar (terbaru dulu). */
export const AUDIT_MAX_FINDINGS_PER_KIND = 50;
/**
 * Versi logika ringkasan. Naikkan bila SQL hitungan di bawah berubah: ringkasan lama tidak cocok lagi (kunci
 * parameter lain) sehingga layar kembali ke agregasi langsung sampai job menghitung ulang.
 */
export const AUDIT_SUMMARY_VERSION = 2;

const DAY_MS = 86_400_000;

/** Jumlah per pengguna per tanggal WIB (dasar temuan anomali). */
export interface AuditDayBucket {
  userId: string | null;
  role: string | null;
  day: string;
  n: number;
  last: Date;
}

/** Rentang waktu catat server [from, to); `to` kosong = sampai sekarang. */
interface Range {
  from: Date;
  to?: Date;
}

interface CountQuery extends Range {
  /** Hanya kelompok dengan hitungan ≥ ambang. */
  threshold: number;
  /** Batas baris (terbaru dulu); kosong = semua. */
  limit?: number;
}

export interface NightWindow {
  /** Menit sejak tengah malam WIB; bila start > end jendela melewati tengah malam (mis. 22:00–05:00). */
  startMin: number;
  endMin: number;
}

const upper = (to?: Date) => (to ? Prisma.sql`AND occurred_at < ${to}` : Prisma.empty);
const limitSql = (limit?: number) => (limit === undefined ? Prisma.empty : Prisma.sql`LIMIT ${limit}`);

/** Lonjakan gagal login / akses ditolak per pengguna per hari (WIB). Pengguna tak dikenal = userId null. */
export function auditBurstBuckets(
  tx: TenantTx,
  action: 'login_failed' | 'access_denied',
  q: CountQuery,
): Promise<AuditDayBucket[]> {
  return tx.$queryRaw<AuditDayBucket[]>`
    SELECT actor_user_id::text AS "userId", max(actor_role) AS role,
           to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
           count(*)::int AS n, max(occurred_at) AS last
    FROM audit_events
    WHERE action = ${action} AND occurred_at >= ${q.from} ${upper(q.to)}
    GROUP BY 1, 3
    HAVING count(*) >= ${q.threshold}
    ORDER BY last DESC
    ${limitSql(q.limit)}`;
}

/** Pengguna yang membuka data pasien di jam malam (WIB) di luar peran jaga 24 jam; tanpa ambang. */
export function auditNightBuckets(
  tx: TenantTx,
  q: Range & NightWindow & { exemptRoles: readonly string[]; limit?: number },
): Promise<AuditDayBucket[]> {
  return tx.$queryRaw<AuditDayBucket[]>`
    WITH e AS (
      SELECT actor_user_id, actor_role, patient_id, occurred_at,
             EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Jakarta') * 60
               + EXTRACT(MINUTE FROM occurred_at AT TIME ZONE 'Asia/Jakarta') AS m
      FROM audit_events
      WHERE patient_id IS NOT NULL AND actor_user_id IS NOT NULL
        AND action = ANY(${[...AUDIT_PATIENT_READ_ACTIONS]}::text[])
        AND (actor_role IS NULL OR actor_role <> ALL(${[...q.exemptRoles]}::text[]))
        AND occurred_at >= ${q.from} ${upper(q.to)}
    )
    SELECT actor_user_id::text AS "userId", max(actor_role) AS role,
           to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
           count(DISTINCT patient_id)::int AS n, max(occurred_at) AS last
    FROM e
    WHERE CASE WHEN ${q.startMin}::int > ${q.endMin}::int THEN m >= ${q.startMin}::int OR m < ${q.endMin}::int
               ELSE m >= ${q.startMin}::int AND m < ${q.endMin}::int END
    GROUP BY 1, 3
    ORDER BY last DESC
    ${limitSql(q.limit)}`;
}

/**
 * EP 10c (fase 3) · Pengguna yang membuka rekam medis pasien RAHASIA (`patients.confidential`, juga rekam medis lain
 * milik orang yang sama) per hari WIB; tanpa ambang: setiap akses adalah temuan untuk ditinjau petugas privasi.
 * Penanda dibaca saat menghitung (pasien yang baru ditandai ikut terhitung untuk hari yang belum diringkas).
 */
export function auditConfidentialBuckets(
  tx: TenantTx,
  q: Range & { limit?: number },
): Promise<AuditDayBucket[]> {
  return tx.$queryRaw<AuditDayBucket[]>`
    SELECT a.actor_user_id::text AS "userId", max(a.actor_role) AS role,
           to_char(a.occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
           count(DISTINCT a.patient_id)::int AS n, max(a.occurred_at) AS last
    FROM audit_events a
    WHERE a.patient_id IS NOT NULL AND a.actor_user_id IS NOT NULL
      AND a.action = ANY(${[...AUDIT_PATIENT_READ_ACTIONS]}::text[])
      AND a.occurred_at >= ${q.from} ${upper(q.to)}
      AND EXISTS (SELECT 1 FROM patients p
                  WHERE p.confidential AND p.id IN (SELECT app_patient_group(a.patient_id)))
    GROUP BY 1, 3
    ORDER BY last DESC
    ${limitSql(q.limit)}`;
}

/** Pengguna yang membuka data pasien berbeda sebanyak ≥ ambang dalam satu hari (WIB). */
export function auditVolumeBuckets(tx: TenantTx, q: CountQuery): Promise<AuditDayBucket[]> {
  return tx.$queryRaw<AuditDayBucket[]>`
    SELECT actor_user_id::text AS "userId", max(actor_role) AS role,
           to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
           count(DISTINCT patient_id)::int AS n, max(occurred_at) AS last
    FROM audit_events
    WHERE patient_id IS NOT NULL AND actor_user_id IS NOT NULL
      AND action = ANY(${[...AUDIT_PATIENT_VOLUME_ACTIONS]}::text[])
      AND occurred_at >= ${q.from} ${upper(q.to)}
    GROUP BY 1, 3
    HAVING count(DISTINCT patient_id) >= ${q.threshold}
    ORDER BY last DESC
    ${limitSql(q.limit)}`;
}

/** Pengaturan RS yang menentukan temuan (P12) + parameter ringkasan yang bergantung padanya. */
export interface AuditAnomalySettings {
  night: { start: string; end: string };
  window: NightWindow;
  exemptRoles: readonly string[];
  volumeThreshold: number;
  burstThreshold: number;
  summary: { params: Record<string, unknown>; key: string };
}

const minutes = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Parameter yang memengaruhi isi ringkasan (bukan ambang: ambang diterapkan saat membaca, karena hitungan di bawah
 * minimum pengaturan sudah dibuang). Kunci = SHA-256 JSON kanonik; jam malam berubah → kunci lain → hitung ulang.
 */
export function auditSummaryParams(window: NightWindow, exemptRoles: readonly string[]) {
  const params = {
    v: AUDIT_SUMMARY_VERSION,
    nightStartMin: window.startMin,
    nightEndMin: window.endMin,
    exemptRoles: [...exemptRoles].sort(),
    readActions: [...AUDIT_PATIENT_READ_ACTIONS],
    volumeActions: [...AUDIT_PATIENT_VOLUME_ACTIONS],
    burstMin: AUDIT_BURST_THRESHOLD_MIN,
    volumeMin: AUDIT_VOLUME_THRESHOLD_MIN,
  };
  return { params, key: createHash('sha256').update(JSON.stringify(params)).digest('hex') };
}

export async function readAuditAnomalySettings(tx: TenantTx): Promise<AuditAnomalySettings> {
  const night = await readTenantSetting(tx, 'audit.night_hours');
  const volumeThreshold = await readTenantSetting(tx, 'audit.volume_threshold');
  const burstThreshold = await readTenantSetting(tx, 'audit.burst_threshold');
  const window = { startMin: minutes(night.start), endMin: minutes(night.end) };
  return {
    night,
    window,
    exemptRoles: NIGHT_SHIFT_ROLES,
    volumeThreshold,
    burstThreshold,
    summary: auditSummaryParams(window, NIGHT_SHIFT_ROLES),
  };
}

/** Awal (00.00 WIB) dan akhir satu tanggal WIB `YYYY-MM-DD`. WIB tanpa DST. */
export function wibDayRange(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+07:00`);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** Tanggal WIB dari `from` (inklusif) sampai `until` (eksklusif). */
function wibDays(from: Date, until: Date): string[] {
  const days: string[] = [];
  for (
    let t = new Date(`${isoDateJakarta(from)}T00:00:00+07:00`).getTime();
    t < until.getTime();
    t += DAY_MS
  ) {
    days.push(isoDateJakarta(new Date(t)));
  }
  return days;
}

/** Ringkasan yang ada untuk tanggal-tanggal itu dengan kunci parameter ini: tanggal → id ringkasan. */
async function summaryCoverage(
  tx: TenantTx,
  days: string[],
  paramsKey: string,
): Promise<Map<string, string>> {
  if (days.length === 0) return new Map();
  const rows = await tx.$queryRaw<Array<{ id: string; day: string }>>`
    SELECT id::text AS id, to_char(day, 'YYYY-MM-DD') AS day
    FROM audit_daily_summaries
    WHERE params_key = ${paramsKey} AND day = ANY(${days}::date[])`;
  return new Map(rows.map((r) => [r.day, r.id]));
}

function summaryBuckets(
  tx: TenantTx,
  kind: AuditAnomalyKind,
  summaryIds: string[],
  threshold: number,
  limit: number,
): Promise<AuditDayBucket[]> {
  if (summaryIds.length === 0) return Promise.resolve([]);
  return tx.$queryRaw<AuditDayBucket[]>`
    SELECT i.actor_user_id::text AS "userId", i.actor_role AS role, to_char(s.day, 'YYYY-MM-DD') AS day,
           i.n, i.last_at AS last
    FROM audit_daily_summary_items i
    JOIN audit_daily_summaries s ON s.tenant_id = i.tenant_id AND s.id = i.summary_id
    WHERE i.summary_id = ANY(${summaryIds}::uuid[]) AND i.kind = ${kind} AND i.n >= ${threshold}
    ORDER BY i.last_at DESC
    LIMIT ${limit}`;
}

export type AuditAnomalyBuckets = Record<AuditAnomalyKind, AuditDayBucket[]>;

/**
 * Dasar temuan anomali sejak `since` (00.00 WIB): hari yang sudah lewat dan punya ringkasan dengan parameter yang
 * sama dibaca dari `audit_daily_summaries`; hari ini dan hari lain dihitung langsung per rentang berurutan. Per jenis:
 * ambang pengaturan, terbaru dulu, paling banyak `limit` (sama dengan satu agregasi langsung atas seluruh jendela,
 * karena setiap kelompok berada di satu tanggal dan setiap sumber sudah mengembalikan `limit` teratasnya).
 */
export async function auditAnomalyBuckets(
  tx: TenantTx,
  q: {
    since: Date;
    now?: Date;
    settings: AuditAnomalySettings;
    /** false = agregasi langsung saja (pembanding di tes). */
    useSummaries?: boolean;
    limit?: number;
  },
): Promise<{ buckets: AuditAnomalyBuckets; summarizedDays: number }> {
  const s = q.settings;
  const limit = q.limit ?? AUDIT_MAX_FINDINGS_PER_KIND;
  const today = isoDateJakarta(q.now ?? new Date());
  const pastDays = wibDays(q.since, wibDayRange(today).from);
  // Hanya tanggal yang seluruhnya di dalam jendela boleh dibaca dari ringkasan (ringkasan = satu hari utuh).
  const eligible = pastDays.filter((d) => wibDayRange(d).from.getTime() >= q.since.getTime());
  const covered =
    q.useSummaries === false ? new Map<string, string>() : await summaryCoverage(tx, eligible, s.summary.key);

  // Rentang langsung: gabungan tanggal berurutan yang tidak diringkas; yang terakhir terbuka (sampai sekarang).
  const ranges: Range[] = [];
  let open: Date | null = null;
  for (const [i, day] of [...pastDays, today].entries()) {
    if (covered.has(day)) {
      if (open) ranges.push({ from: open, to: wibDayRange(day).from });
      open = null;
    } else {
      open ??= i === 0 ? q.since : wibDayRange(day).from;
    }
  }
  if (open) ranges.push({ from: open });

  const ids = [...covered.values()];
  const merge = async (
    kind: AuditAnomalyKind,
    threshold: number,
    live: (r: Range) => Promise<AuditDayBucket[]>,
  ): Promise<AuditDayBucket[]> => {
    const parts = [await summaryBuckets(tx, kind, ids, threshold, limit)];
    for (const r of ranges) parts.push(await live(r));
    return parts
      .flat()
      .sort((a, b) => b.last.getTime() - a.last.getTime())
      .slice(0, limit);
  };

  const buckets: AuditAnomalyBuckets = {
    login_failed: await merge('login_failed', s.burstThreshold, (r) =>
      auditBurstBuckets(tx, 'login_failed', { ...r, threshold: s.burstThreshold, limit }),
    ),
    access_denied: await merge('access_denied', s.burstThreshold, (r) =>
      auditBurstBuckets(tx, 'access_denied', { ...r, threshold: s.burstThreshold, limit }),
    ),
    // Malam tanpa ambang: setiap akses di jendela malam adalah temuan.
    night: await merge('night', 1, (r) =>
      auditNightBuckets(tx, { ...r, ...s.window, exemptRoles: s.exemptRoles, limit }),
    ),
    volume: await merge('volume', s.volumeThreshold, (r) =>
      auditVolumeBuckets(tx, { ...r, threshold: s.volumeThreshold, limit }),
    ),
    confidential: await merge('confidential', 1, (r) => auditConfidentialBuckets(tx, { ...r, limit })),
  };
  return { buckets, summarizedDays: covered.size };
}

/**
 * Ringkas satu tanggal WIB yang sudah lewat untuk tenant aktif (di dalam `withTenant`). Idempoten: ringkasan
 * dengan kunci parameter yang sama sudah ada (atau ditulis proses lain bersamaan) → tidak menulis apa pun.
 * Hitungan di bawah ambang minimum pengaturan dibuang (tidak pernah menjadi temuan).
 */
export async function summarizeAuditDay(
  tx: TenantTx,
  tenantId: string,
  day: string,
  settings: AuditAnomalySettings,
): Promise<{ created: boolean; items: number }> {
  const { from, to } = wibDayRange(day);
  const dayDate = new Date(`${day}T00:00:00Z`);
  const exists = await tx.auditDailySummary.findUnique({
    where: { tenantId_day_paramsKey: { tenantId, day: dayDate, paramsKey: settings.summary.key } },
    select: { id: true },
  });
  if (exists) return { created: false, items: 0 };

  const rows: Array<{ kind: AuditAnomalyKind; b: AuditDayBucket }> = [];
  const add = (kind: AuditAnomalyKind, list: AuditDayBucket[]) => {
    for (const b of list) rows.push({ kind, b });
  };
  add(
    'login_failed',
    await auditBurstBuckets(tx, 'login_failed', { from, to, threshold: AUDIT_BURST_THRESHOLD_MIN }),
  );
  add(
    'access_denied',
    await auditBurstBuckets(tx, 'access_denied', { from, to, threshold: AUDIT_BURST_THRESHOLD_MIN }),
  );
  add(
    'night',
    await auditNightBuckets(tx, { from, to, ...settings.window, exemptRoles: settings.exemptRoles }),
  );
  add('volume', await auditVolumeBuckets(tx, { from, to, threshold: AUDIT_VOLUME_THRESHOLD_MIN }));
  add('confidential', await auditConfidentialBuckets(tx, { from, to }));
  const [count] = await tx.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM audit_events WHERE occurred_at >= ${from} AND occurred_at < ${to}`;

  const id = newId();
  const header = await tx.auditDailySummary.createMany({
    data: [
      {
        id,
        tenantId,
        day: dayDate,
        paramsKey: settings.summary.key,
        params: settings.summary.params as Prisma.InputJsonValue,
        eventCount: count?.n ?? 0,
        itemCount: rows.length,
      },
    ],
    skipDuplicates: true,
  });
  if (header.count === 0) return { created: false, items: 0 };
  if (rows.length > 0) {
    await tx.auditDailySummaryItem.createMany({
      data: rows.map(({ kind, b }) => ({
        id: newId(),
        tenantId,
        summaryId: id,
        kind,
        actorUserId: b.userId,
        actorRole: b.role,
        n: b.n,
        lastAt: b.last,
      })),
    });
  }
  return { created: true, items: rows.length };
}

/**
 * Tanggal WIB yang siap diringkas tetapi belum punya ringkasan dengan parameter sekarang, terlama dulu: dalam
 * `lookbackDays` hari terakhir (jendela layar maks. 90 hari) dan sudah berakhir minimal `settleMs` (transaksi yang
 * menulis audit menjelang tengah malam sudah commit).
 */
export async function pendingAuditSummaryDays(
  tx: TenantTx,
  settings: AuditAnomalySettings,
  opts: { now: Date; lookbackDays: number; settleMs: number },
): Promise<string[]> {
  const today = isoDateJakarta(opts.now);
  const start = new Date(wibDayRange(today).from.getTime() - (opts.lookbackDays - 1) * DAY_MS);
  const days = wibDays(start, wibDayRange(today).from).filter(
    (d) => wibDayRange(d).to.getTime() + opts.settleMs <= opts.now.getTime(),
  );
  const covered = await summaryCoverage(tx, days, settings.summary.key);
  return days.filter((d) => !covered.has(d));
}
