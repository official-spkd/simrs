/**
 * I03 · Konektor BPJS (mode presentasi, ADR-0023): VClaim, Antrean (task ID 1–7), Aplicare, dan HFIS sebagai kartu
 * terpisah dengan volume, latensi, dan gangguan; urutan task ID dijaga (task n hanya setelah task n−1); mode
 * downtime manual dengan alasan wajib, transaksi tertunda disinkronkan berurutan saat pulih. Rencana fase 7 §7.4.
 */

export type BpjsServiceId = 'vclaim' | 'antrean' | 'aplicare' | 'hfis';
export type ServiceStatus = 'normal' | 'lambat' | 'gangguan';

export interface BpjsOperation {
  name: string;
  count: number;
  failed: number;
  p95Ms: number;
}

export interface BpjsService {
  id: BpjsServiceId;
  name: string;
  protocol: string;
  /** Kebijakan retry worker (teks dari `apps/worker`). */
  retry: string;
  ops: readonly BpjsOperation[];
  lastError: string | null;
}

/** Status kartu dari p95 dan rasio gagal: gagal ≥ 5% = gangguan; p95 ≥ 1 dtk atau gagal ≥ 1% = lambat. */
export function serviceStatus(s: Pick<BpjsService, 'ops'>): ServiceStatus {
  const total = s.ops.reduce((a, o) => a + o.count, 0);
  const failed = s.ops.reduce((a, o) => a + o.failed, 0);
  const p95 = Math.max(0, ...s.ops.map((o) => o.p95Ms));
  const ratio = total ? failed / total : 0;
  if (ratio >= 0.05) return 'gangguan';
  if (p95 >= 1000 || ratio >= 0.01) return 'lambat';
  return 'normal';
}

export function serviceTotals(s: Pick<BpjsService, 'ops'>) {
  const volume = s.ops.reduce((a, o) => a + o.count, 0);
  const failed = s.ops.reduce((a, o) => a + o.failed, 0);
  return { volume, failed, p95Ms: Math.max(0, ...s.ops.map((o) => o.p95Ms)) };
}

// ─── Antrean: task ID 1–7 ──────────────────────────────────────────────────────────────────────────────────

export const TASK_LABEL: Record<number, string> = {
  1: 'Mulai tunggu admisi',
  2: 'Mulai layan admisi',
  3: 'Selesai admisi / mulai tunggu poli',
  4: 'Mulai layan poli',
  5: 'Selesai poli / mulai tunggu farmasi',
  6: 'Mulai buat obat',
  7: 'Obat selesai',
};

export type TaskStatus = 'terkirim' | 'belum' | 'gagal';

export interface BookingTasks {
  bookingCode: string;
  patient: string;
  poli: string;
  tasks: Readonly<Record<number, { status: TaskStatus; at: string | null; error?: string }>>;
}

/** Task n boleh dikirim bila semua task sebelumnya sudah terkirim (aturan Antrean BPJS). */
export function taskOrderGate(b: BookingTasks, n: number): number | null {
  for (let i = 1; i < n; i++) if (b.tasks[i]?.status !== 'terkirim') return i;
  return null;
}

/** Kirim ulang berurutan: kirim task yang tertinggal mulai dari yang terkecil sampai task gagal ikut terkirim. */
export function resendInOrder(b: BookingTasks, at: string): { next: BookingTasks; sent: number[] } {
  const failed = Object.entries(b.tasks)
    .filter(([, t]) => t.status === 'gagal')
    .map(([k]) => Number(k));
  const upTo = Math.max(0, ...failed);
  const sent: number[] = [];
  const tasks = { ...b.tasks };
  for (let i = 1; i <= upTo; i++) {
    if (tasks[i]?.status !== 'terkirim') {
      tasks[i] = { status: 'terkirim', at };
      sent.push(i);
    }
  }
  return { next: { ...b, tasks }, sent };
}

// ─── Aplicare dan HFIS ─────────────────────────────────────────────────────────────────────────────────────

export interface BedClassRow {
  kelas: string;
  total: number;
  /** Tersedia menurut SIM RS saat ini. */
  available: number;
  /** Tersedia menurut kiriman terakhir ke Aplicare. */
  reported: number;
}

export function aplicareDiffs(rows: readonly BedClassRow[]): BedClassRow[] {
  return rows.filter((r) => r.available !== r.reported);
}

export interface HfisRow {
  doctor: string;
  poli: string;
  simrs: string;
  hfis: string;
}

export const hfisMismatch = (r: HfisRow) => r.simrs !== r.hfis;

// ─── Mode downtime ─────────────────────────────────────────────────────────────────────────────────────────

export const DOWNTIME_REASON_MIN = 10;

export function downtimeGate(reason: string): string | null {
  return reason.trim().length >= DOWNTIME_REASON_MIN
    ? null
    : `Alasan mode downtime wajib diisi (minimal ${DOWNTIME_REASON_MIN} karakter) dan tercatat di jejak audit.`;
}

export interface PendingTx {
  at: string;
  kind: 'SEP' | 'Task ID' | 'Aplicare';
  label: string;
}

/** Urutan sinkron saat pulih: menurut waktu kejadian (lalu jenis: SEP sebelum task ID). */
export function syncOrder(backlog: readonly PendingTx[]): PendingTx[] {
  const rank = { SEP: 0, 'Task ID': 1, Aplicare: 2 } as const;
  return [...backlog].sort((a, b) => a.at.localeCompare(b.at) || rank[a.kind] - rank[b.kind]);
}
