import { isValidRefCode, REF_CODE_SYSTEMS, type RefCodeSystem } from '@simrs/shared';

/**
 * P06 · Data rujukan/terminologi (mode presentasi, ADR-0023). Meniru perilaku `packages/db/src/ref.ts` di sisi web
 * tanpa database: cari kode persis/awalan atau kata mirip (trigram, tahan salah ketik), dan impor CSV dengan uji
 * kering yang gagal tertutup (satu baris galat = tidak ada yang ditulis).
 */

export interface RefConcept {
  system: RefCodeSystem;
  code: string;
  display: string;
  active: boolean;
}

export type MatchKind = 'kode' | 'awalan' | 'teks' | 'mirip';

export interface SearchHit {
  concept: RefConcept;
  match: MatchKind;
  /** 0–1; 1 untuk kode persis. */
  score: number;
}

export const MATCH_LABEL: Record<MatchKind, string> = {
  kode: 'kode persis',
  awalan: 'awalan kode',
  teks: 'kata di label',
  mirip: 'ejaan mirip',
};

function trigrams(word: string): Set<string> {
  const w = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3));
  return out;
}

/** Kemiripan trigram dua kata (seperti `similarity()` pg_trgm). */
export function wordSimilarity(a: string, b: string): number {
  const ta = trigrams(a.toLowerCase());
  const tb = trigrams(b.toLowerCase());
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);

/** Kemiripan kueri terhadap label: rata-rata kemiripan terbaik tiap kata kueri. */
export function textSimilarity(q: string, display: string): number {
  const qs = words(q);
  const ds = words(display);
  if (qs.length === 0 || ds.length === 0) return 0;
  const best = qs.map((w) => Math.max(...ds.map((d) => wordSimilarity(w, d))));
  return best.reduce((s, x) => s + x, 0) / best.length;
}

export const FUZZY_THRESHOLD = 0.35;

/** Urutan: kode persis, awalan kode, kata di label, lalu kemiripan ejaan (seperti `searchConcepts`). */
export function searchConcepts(
  concepts: readonly RefConcept[],
  opts: { system: RefCodeSystem; q: string; includeInactive?: boolean; limit?: number },
): SearchHit[] {
  const q = opts.q.trim();
  if (q.length === 0) return [];
  const code = q.toUpperCase();
  const text = q.toLowerCase();
  const hits: SearchHit[] = [];
  for (const c of concepts) {
    if (c.system !== opts.system || (!opts.includeInactive && !c.active)) continue;
    if (c.code === code) hits.push({ concept: c, match: 'kode', score: 1 });
    else if (c.code.startsWith(code)) hits.push({ concept: c, match: 'awalan', score: 0.95 });
    else if (c.display.toLowerCase().includes(text)) hits.push({ concept: c, match: 'teks', score: 0.9 });
    else {
      const s = textSimilarity(text, c.display);
      if (s >= FUZZY_THRESHOLD) hits.push({ concept: c, match: 'mirip', score: s });
    }
  }
  const rank: Record<MatchKind, number> = { kode: 0, awalan: 1, teks: 2, mirip: 3 };
  return hits
    .sort(
      (a, b) =>
        rank[a.match] - rank[b.match] || b.score - a.score || a.concept.code.localeCompare(b.concept.code),
    )
    .slice(0, opts.limit ?? 20);
}

// ---------------------------------------------------------------------------------------------------------
// Impor CSV (uji kering → ringkasan → terapkan)
// ---------------------------------------------------------------------------------------------------------

export interface CsvRow {
  line: number;
  values: Record<string, string>;
  malformed?: string;
}

/** CSV sederhana ber-header (`code,display[,active]`); nilai berkoma boleh diapit tanda kutip ganda. */
export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const split = (line: string): string[] | null => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (quoted) return null;
    out.push(cur.trim());
    return out;
  };
  const header = (split(lines[0] ?? '') ?? []).map((h) => h.toLowerCase());
  const rows: CsvRow[] = [];
  lines.slice(1).forEach((line, i) => {
    if (line.trim() === '') return;
    const cells = split(line);
    const lineNo = i + 2;
    if (!cells) {
      rows.push({ line: lineNo, values: {}, malformed: 'tanda kutip tidak ditutup' });
      return;
    }
    if (cells.length !== header.length) {
      rows.push({
        line: lineNo,
        values: {},
        malformed: `jumlah kolom ${cells.length}, seharusnya ${header.length}`,
      });
      return;
    }
    rows.push({ line: lineNo, values: Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ''])) });
  });
  return { header, rows };
}

export interface ImportReport {
  system: RefCodeSystem;
  rows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  errors: Array<{ line: number; message: string }>;
  /** Baris valid siap ditulis (hanya dipakai bila `errors` kosong). */
  valid: RefConcept[];
}

function parseActive(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') return true;
  const v = raw.toLowerCase();
  if (['true', '1', 'ya', 'aktif', 'y'].includes(v)) return true;
  if (['false', '0', 'tidak', 'nonaktif', 'n'].includes(v)) return false;
  return null;
}

/**
 * Uji kering: validasi tiap baris (format kode per sistem + check digit LOINC, label wajib, kolom active, kode
 * ganda) dan hitung dampak terhadap data aktif. `replace` = kode yang tidak ada di berkas akan dinonaktifkan.
 */
export function dryRunImport(
  existing: readonly RefConcept[],
  system: RefCodeSystem,
  csv: { header: string[]; rows: CsvRow[] },
  replace: boolean,
): ImportReport {
  const report: ImportReport = {
    system,
    rows: csv.rows.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
    errors: [],
    valid: [],
  };
  if (!csv.header.includes('code') || !csv.header.includes('display')) {
    report.errors.push({ line: 1, message: 'header wajib memuat kolom code dan display' });
    return report;
  }
  const label = REF_CODE_SYSTEMS[system];
  const seen = new Set<string>();
  for (const r of csv.rows) {
    const code = (r.values.code ?? '').toUpperCase();
    const display = r.values.display ?? '';
    const active = parseActive(r.values.active);
    const problem = r.malformed
      ? r.malformed
      : !isValidRefCode(system, code)
        ? `kode "${code}" tidak valid untuk ${label.label} (${label.hint})`
        : !display || display.length > 500
          ? 'label (display) wajib diisi, maks. 500 karakter'
          : active === null
            ? `kolom active tidak dikenali: "${r.values.active}"`
            : seen.has(code)
              ? `kode ${code} muncul lebih dari sekali`
              : null;
    if (problem) {
      report.errors.push({ line: r.line, message: problem });
      continue;
    }
    seen.add(code);
    report.valid.push({ system, code, display, active: active as boolean });
  }
  const current = new Map(existing.filter((c) => c.system === system).map((c) => [c.code, c]));
  for (const v of report.valid) {
    const old = current.get(v.code);
    if (!old) report.inserted++;
    else if (old.display !== v.display || old.active !== v.active) report.updated++;
    else report.unchanged++;
  }
  if (replace) {
    report.deactivated = [...current.values()].filter((c) => c.active && !seen.has(c.code)).length;
  }
  return report;
}

/** Terapkan laporan uji kering yang bersih (gagal tertutup bila masih ada galat). */
export function applyImport(
  existing: readonly RefConcept[],
  report: ImportReport,
  replace: boolean,
): RefConcept[] {
  if (report.errors.length > 0) throw new Error('Impor dengan galat tidak boleh diterapkan');
  const incoming = new Map(report.valid.map((c) => [c.code, c]));
  const kept = existing.map((c) => {
    if (c.system !== report.system) return c;
    const next = incoming.get(c.code);
    if (next) {
      incoming.delete(c.code);
      return next;
    }
    return replace ? { ...c, active: false } : c;
  });
  return [...kept, ...incoming.values()];
}

export interface RefVersion {
  system: RefCodeSystem;
  version: string;
  source: string;
  appliedAt: string;
  appliedBy: string;
  inserted: number;
  updated: number;
  deactivated: number;
}
