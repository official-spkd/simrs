import { hasReason } from './rme';

/**
 * K13 · Dokumen pasien dan kelengkapan rekam medis per kunjungan: daftar dokumen (final ber-TTE, menunggu TTE, TTE
 * gagal → kirim ulang, draf, pindaian terunggah, dibatalkan beralasan; tidak pernah dihapus) dan daftar periksa DPJP
 * sebelum menutup kunjungan (gerbang tutup encounter, EP 5c). Tutup kunjungan hanya oleh DPJP, semua butir
 * terpenuhi, dan disposisi dipilih; setelah ditutup rekam terkunci (perubahan lewat addendum).
 */

export type DocStatus =
  'final' | 'final-tte' | 'menunggu-tte' | 'tte-gagal' | 'draf' | 'terunggah' | 'dibatalkan';

export const DOC_STATUS_META: Record<
  DocStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  final: { label: 'Final · atestasi elektronik', tone: 'success' },
  'final-tte': { label: 'Final · TTE', tone: 'success' },
  'menunggu-tte': { label: 'Menunggu TTE', tone: 'warning' },
  'tte-gagal': { label: 'TTE gagal', tone: 'danger' },
  draf: { label: 'Draf', tone: 'neutral' },
  terunggah: { label: 'Pindaian terunggah', tone: 'info' },
  dibatalkan: { label: 'Dibatalkan', tone: 'neutral' },
};

export interface PatientDocument {
  id: string;
  title: string;
  kind: string;
  status: DocStatus;
  by: string;
  at: string;
  /** Alasan pembatalan / pesan galat TTE. */
  note: string | null;
}

/** Batalkan dokumen = status dibatalkan beralasan (dokumen tetap ada di daftar). */
export function cancelDocument(
  doc: PatientDocument,
  reason: string,
  by: string,
  at: string,
): PatientDocument {
  if (doc.status === 'final-tte' || doc.status === 'final')
    throw new Error('Dokumen final tidak bisa dibatalkan; buat addendum.');
  if (!hasReason(reason)) throw new Error('Alasan pembatalan minimal 10 karakter.');
  return { ...doc, status: 'dibatalkan', note: reason.trim(), by, at };
}

export function cancelBlocker(doc: Pick<PatientDocument, 'status'>): string | null {
  if (doc.status === 'final-tte' || doc.status === 'final')
    return 'Dokumen final terkunci; koreksi lewat addendum.';
  if (doc.status === 'dibatalkan') return 'Sudah dibatalkan.';
  return null;
}

/** Kirim ulang TTE hanya untuk dokumen yang TTE-nya gagal (bukan dokumen dibatalkan/final). */
export function tteRetryBlocker(doc: Pick<PatientDocument, 'status'>): string | null {
  if (doc.status === 'dibatalkan')
    return 'Dokumen sudah dibatalkan; buat dokumen baru bila masih diperlukan.';
  if (doc.status !== 'tte-gagal') return 'Hanya dokumen dengan TTE gagal yang dikirim ulang.';
  return null;
}

export function retryTte(doc: PatientDocument, by: string, at: string): PatientDocument {
  const block = tteRetryBlocker(doc);
  if (block) throw new Error(block);
  return { ...doc, status: 'final-tte', at, by, note: null };
}

export type CheckFix =
  | { kind: 'cosign' }
  | { kind: 'tte-ulang'; documentId: string }
  | { kind: 'layar'; screen: string; suffix?: string };

export interface CheckItem {
  id: string;
  label: string;
  done: boolean;
  /** Keterangan kondisi sekarang, mis. "1 catatan residen menunggu co-sign". */
  detail: string;
  fix: CheckFix | null;
}

export type Disposition = 'pulang' | 'rujuk' | 'aps' | 'meninggal';

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  pulang: 'Pulang atas persetujuan DPJP',
  rujuk: 'Dirujuk ke fasilitas lain',
  aps: 'Pulang atas permintaan sendiri',
  meninggal: 'Meninggal',
};

/** Dokumen wajib tambahan per disposisi (DischargeGate): rujuk → surat rujukan, meninggal → surat kematian. */
export const DISPOSITION_DOC: Partial<Record<Disposition, string>> = {
  rujuk: 'Surat rujukan',
  meninggal: 'Surat keterangan kematian',
};

/** Gerbang tutup kunjungan. Null = boleh ditutup. */
export function closeBlocker(
  items: readonly CheckItem[],
  o: { role: string | null; disposition: Disposition | ''; documents: readonly PatientDocument[] },
): string | null {
  if (o.role !== 'dokter') return 'Kunjungan ditutup oleh DPJP (posisi dokter).';
  const open = items.filter((i) => !i.done);
  if (open.length > 0)
    return `${open.length} butir kelengkapan belum terpenuhi: ${open.map((i) => i.label).join('; ')}.`;
  if (!o.disposition) return 'Pilih disposisi pasien.';
  const need = DISPOSITION_DOC[o.disposition];
  if (need && !o.documents.some((d) => d.title === need && d.status === 'final-tte')) {
    return `Disposisi ini membutuhkan ${need.toLowerCase()} yang sudah ber-TTE.`;
  }
  return null;
}

export function completeness(items: readonly CheckItem[]): { done: number; total: number; percent: number } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 100 };
}
