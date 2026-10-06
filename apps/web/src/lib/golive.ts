/**
 * Fase 10 · Kesiapan go-live (mode presentasi, ADR-0023; rencana fase 10 §10.10): matriks 51 EP MRMIK dengan bukti
 * per EP dan ceklis/runbook go-live berpemilik. Keputusan GO terkunci sampai semua item kritis selesai dan
 * berpemilik; catatan keputusan wajib.
 */

export type EpClass = 'kunci' | 'pendukung' | 'tata-kelola';
export type EpStatus = 'terpenuhi' | 'sebagian' | 'belum' | 'ranah-rs';

export interface MrmikEp {
  no: number;
  ep: string;
  inti: string;
  kelas: EpClass;
  status: EpStatus;
  bukti: string;
  /** Layar bukti di SIM RS (null = dokumen/prosedur RS atau belum ada). */
  route: string | null;
}

export const CLASS_LABEL: Record<EpClass, string> = {
  kunci: 'Kunci',
  pendukung: 'Pendukung',
  'tata-kelola': 'Tata kelola',
};

export const STATUS_LABEL: Record<EpStatus, string> = {
  terpenuhi: 'Terpenuhi',
  sebagian: 'Sebagian',
  belum: 'Belum',
  'ranah-rs': 'Ranah RS',
};

/** Kelompok MRMIK dari nomor EP (docs/03): a manajemen informasi 1–2.2, b dokumen & penyebaran 3–4, c RME 5–12, d SIMRS 13. */
export function epGroup(ep: string): 'a' | 'b' | 'c' | 'd' {
  const n = Number(/MRMIK (\d+)/.exec(ep)?.[1] ?? 0);
  if (n <= 2) return 'a';
  if (n <= 4) return 'b';
  if (n <= 12) return 'c';
  return 'd';
}

export const GROUP_LABEL = {
  a: 'Manajemen informasi',
  b: 'Dokumen dan penyebaran data',
  c: 'Rekam medis elektronik',
  d: 'SIMRS dan downtime',
} as const;

export function matrixSummary(eps: readonly MrmikEp[]) {
  const by = (k: EpClass) => eps.filter((e) => e.kelas === k).length;
  const sys = eps.filter((e) => e.kelas !== 'tata-kelola');
  return {
    total: eps.length,
    kunci: by('kunci'),
    pendukung: by('pendukung'),
    tataKelola: by('tata-kelola'),
    terpenuhi: eps.filter((e) => e.status === 'terpenuhi').length,
    sebagian: eps.filter((e) => e.status === 'sebagian').length,
    belum: eps.filter((e) => e.status === 'belum').length,
    /** EP kunci yang belum terpenuhi penuh (fokus sebelum go-live). */
    kunciTerbuka: eps.filter((e) => e.kelas === 'kunci' && e.status !== 'terpenuhi').length,
    /** Persentase EP sistem (kunci + pendukung) yang terpenuhi. */
    persenSistem: sys.length
      ? Math.round((sys.filter((e) => e.status === 'terpenuhi').length / sys.length) * 100)
      : 0,
  };
}

export interface ChecklistItem {
  id: string;
  text: string;
  critical: boolean;
  owner: string;
  done: boolean;
}

export interface ChecklistArea {
  area: string;
  items: ChecklistItem[];
}

export type ItemState = Record<string, { done: boolean; owner: string }>;

export function itemStateFrom(areas: readonly ChecklistArea[]): ItemState {
  return Object.fromEntries(
    areas.flatMap((a) => a.items.map((i) => [i.id, { done: i.done, owner: i.owner }])),
  );
}

/** Item kritis yang belum selesai atau belum berpemilik (mengunci keputusan GO). */
export function openCritical(areas: readonly ChecklistArea[], state: ItemState): ChecklistItem[] {
  return areas
    .flatMap((a) => a.items)
    .filter((i) => i.critical && !(state[i.id]?.done && (state[i.id]?.owner ?? '') !== ''));
}

export type Decision = { kind: 'go' | 'nogo'; note: string; at: string };

export const MIN_NOTE = 10;

export function canDecide(
  kind: 'go' | 'nogo',
  note: string,
  areas: readonly ChecklistArea[],
  state: ItemState,
): { ok: true } | { ok: false; reason: string } {
  if (note.trim().length < MIN_NOTE)
    return { ok: false, reason: `Tulis catatan keputusan minimal ${MIN_NOTE} huruf.` };
  if (kind === 'go') {
    const open = openCritical(areas, state);
    if (open.length > 0)
      return {
        ok: false,
        reason: `Terkunci: ${open.length} item kritis belum selesai atau belum berpemilik.`,
      };
  }
  return { ok: true };
}
