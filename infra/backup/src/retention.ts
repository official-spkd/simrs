/**
 * Kebijakan retensi (ADR-0071), sama untuk ketiga lokasi dan dihitung terpisah per lokasi:
 * - per jam: N terbaru; harian: N terbaru; bulanan: harian terbaru tiap bulan kalender (UTC) untuk N bulan terakhir;
 *   manual: N terbaru.
 * - Backup terbaru yang lengkap SELALU disimpan, apa pun jenisnya; begitu pula kunci yang dilindungi (run berjalan).
 * - Folder tanpa manifest (tidak lengkap) dihapus setelah masa tenggang (run gagal/terputus); sebelum itu dibiarkan
 *   karena bisa saja masih diunggah.
 * Fungsi murni: tidak menyentuh penyimpanan, mudah dites.
 */
import { type BackupKind, parseBackupKey } from './manifest';

export interface RetentionPolicy {
  hourly: number;
  daily: number;
  monthly: number;
  manual: number;
  incompleteGraceHours: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  hourly: 48,
  daily: 35,
  monthly: 12,
  manual: 10,
  incompleteGraceHours: 24,
};

export interface StoredRun {
  key: string;
  /** Manifest ada (backup lengkap). */
  complete: boolean;
}

export interface RetentionPlan {
  keep: string[];
  prune: string[];
  /** Nama yang bukan kunci backup: tidak pernah disentuh. */
  ignored: string[];
}

interface ParsedRun extends StoredRun {
  kind: BackupKind;
  startedAt: Date;
}

const newestFirst = (a: ParsedRun, b: ParsedRun) => b.startedAt.getTime() - a.startedAt.getTime();

export function planRetention(
  runs: readonly StoredRun[],
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  protect: ReadonlySet<string> = new Set(),
): RetentionPlan {
  const ignored: string[] = [];
  const parsed: ParsedRun[] = [];
  for (const run of runs) {
    const p = parseBackupKey(run.key);
    if (p) parsed.push({ ...run, ...p });
    else ignored.push(run.key);
  }
  const keep = new Set<string>([...protect].filter((k) => parsed.some((r) => r.key === k)));
  const complete = parsed.filter((r) => r.complete).sort(newestFirst);

  const newest = complete[0];
  if (newest) keep.add(newest.key);
  const take = (kind: BackupKind, n: number) => {
    for (const r of complete.filter((x) => x.kind === kind).slice(0, Math.max(0, n))) keep.add(r.key);
  };
  take('hourly', policy.hourly);
  take('daily', policy.daily);
  take('manual', policy.manual);

  const months = new Set<string>();
  for (const r of complete.filter((x) => x.kind === 'daily')) {
    const month = r.startedAt.toISOString().slice(0, 7);
    if (months.has(month)) continue;
    if (months.size >= Math.max(0, policy.monthly)) break;
    months.add(month);
    keep.add(r.key);
  }

  const graceMs = policy.incompleteGraceHours * 3_600_000;
  for (const r of parsed) {
    if (!r.complete && now.getTime() - r.startedAt.getTime() < graceMs) keep.add(r.key);
  }

  const prune = parsed
    .filter((r) => !keep.has(r.key))
    .sort(newestFirst)
    .map((r) => r.key);
  return { keep: [...keep].sort(), prune, ignored };
}
