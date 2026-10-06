/**
 * U06 · Workbench koder (mode presentasi, ADR-0023; rencana fase 5 potongan 5.5): kode ditarik dari RME dengan
 * sumbernya, saran kode lebih spesifik, validasi bukti per kode (tautan bukti atau alasan ≥ 10 karakter), query ke
 * DPJP (jawaban berupa koreksi/addendum di RME — koder tidak pernah mengubah RME), dan versi koding baru beralasan
 * setelah berkas terkirim (pending/dispute). Murni.
 */

export type SumberKode = 'resume' | 'cppt' | 'lab' | 'radiologi' | 'laporan-operasi' | 'addendum';

export const SUMBER_KODE_LABEL: Record<SumberKode, string> = {
  resume: 'resume medis',
  cppt: 'CPPT',
  lab: 'hasil lab',
  radiologi: 'hasil radiologi',
  'laporan-operasi': 'laporan operasi',
  addendum: 'addendum resume DPJP',
};

export interface Bukti {
  id: string;
  label: string;
  source: SumberKode;
}

export interface KodeBerkas {
  id: string;
  system: 'ICD-10' | 'ICD-9-CM';
  code: string;
  name: string;
  role: 'utama' | 'sekunder' | 'prosedur';
  source: SumberKode;
  sourceNote: string;
  /** Kode ini butuh bukti klinis tertaut (mis. diagnosis yang menaikkan severitas). */
  needsEvidence: boolean;
  evidence: Bukti | null;
  /** Alasan mempertahankan tanpa tautan bukti (≥ KEEP_REASON_MIN). */
  keepReason: string | null;
  /** Saran kode lebih spesifik; `decided` = diterima/ditolak koder. */
  suggestion: {
    code: string;
    name: string;
    why: string;
    evidence: Bukti;
    decided: 'terima' | 'tolak' | null;
  } | null;
  /** Dihapus pada versi koding ini (tetap terlihat di riwayat). */
  removed?: boolean;
}

export interface QueryDpjp {
  question: string;
  to: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
  /** Kode yang dikonfirmasi lewat jawaban (bukti dari addendum). */
  confirms: string;
}

export type StatusBerkas = 'perlu-koding' | 'query-dpjp' | 'siap-grouping' | 'pending' | 'tanggapan-siap';

export interface VersiKoding {
  version: number;
  at: string;
  by: string;
  note: string;
}

export interface BerkasKoding {
  id: string;
  patient: { name: string; rm: string; place: string; payer: string };
  episode: string;
  dpjp: string;
  status: StatusBerkas;
  /** Berkas sudah terkirim ke verifikator: perubahan kode = versi baru beralasan. */
  sent: boolean;
  verifierNote: string | null;
  codes: KodeBerkas[];
  query: QueryDpjp | null;
  versions: VersiKoding[];
}

export const KEEP_REASON_MIN = 10;
export const VERSION_REASON_MIN = 15;

export const STATUS_BERKAS_LABEL: Record<StatusBerkas, string> = {
  'perlu-koding': 'Perlu koding',
  'query-dpjp': 'Menunggu jawaban DPJP',
  'siap-grouping': 'Siap grouping',
  pending: 'Pending verifikator',
  'tanggapan-siap': 'Tanggapan siap dikirim',
};

export type StatusKode = 'valid' | 'perlu-bukti' | 'ada-saran' | 'dihapus';

export function codeStatus(c: KodeBerkas): StatusKode {
  if (c.removed) return 'dihapus';
  if (c.suggestion && !c.suggestion.decided) return 'ada-saran';
  if (c.needsEvidence && !c.evidence && (c.keepReason?.trim().length ?? 0) < KEEP_REASON_MIN)
    return 'perlu-bukti';
  return 'valid';
}

/** Kode efektif (saran diterima → kode pengganti; bukti saran ikut tertaut). */
export function effectiveCode(c: KodeBerkas): Pick<KodeBerkas, 'code' | 'name' | 'evidence'> {
  if (c.suggestion?.decided === 'terima') {
    return { code: c.suggestion.code, name: c.suggestion.name, evidence: c.suggestion.evidence };
  }
  return { code: c.code, name: c.name, evidence: c.evidence };
}

/**
 * Validasi berkas sebelum diteruskan ke grouping / tanggapan verifikator: satu diagnosis utama, semua saran
 * diputuskan, semua kode butuh-bukti tertaut atau beralasan, query DPJP terjawab. Daftar kosong = lolos.
 */
export function validateBerkas(b: Pick<BerkasKoding, 'codes' | 'query'>): string[] {
  const active = b.codes.filter((c) => !c.removed);
  const out: string[] = [];
  const utama = active.filter((c) => c.role === 'utama').length;
  if (utama !== 1) out.push(`harus tepat satu diagnosis utama (ada ${utama})`);
  const sug = active.filter((c) => codeStatus(c) === 'ada-saran');
  if (sug.length) out.push(`putuskan saran kode ${sug.map((c) => c.code).join(', ')}`);
  const ev = active.filter((c) => codeStatus(c) === 'perlu-bukti');
  if (ev.length) out.push(`tautkan bukti atau tulis alasan untuk ${ev.map((c) => c.code).join(', ')}`);
  if (b.query && !b.query.answer) out.push('tunggu jawaban query DPJP');
  return out;
}

/** Jawaban DPJP masuk: kode yang dikonfirmasi tertaut ke addendum resume sebagai bukti. */
export function applyAnswer(b: BerkasKoding, answer: string, at: string): BerkasKoding {
  if (!b.query) return b;
  const confirms = b.query.confirms;
  return {
    ...b,
    status: 'perlu-koding',
    query: { ...b.query, answer, answeredAt: at },
    codes: b.codes.map((c) =>
      c.code === confirms
        ? {
            ...c,
            evidence: { id: `${c.id}-add`, label: `Addendum resume DPJP · ${answer}`, source: 'addendum' },
          }
        : c,
    ),
  };
}

/** Versi koding baru (berkas sudah terkirim): alasan wajib ≥ 15 karakter. */
export function versionProblem(b: Pick<BerkasKoding, 'sent'>, reason: string): string | null {
  if (!b.sent) return null;
  const short = VERSION_REASON_MIN - reason.trim().length;
  return short > 0 ? `Tulis alasan versi baru (min. ${VERSION_REASON_MIN} karakter, ${short} lagi).` : null;
}
