/**
 * B12 · Dokumen regulasi dan akreditasi (rencana fase 8 §8.7): DMS berversi `draf → telaah → disetujui → terbit`,
 * versi lama otomatis usang (tetap tersimpan, bertanda "TIDAK BERLAKU"), tinjau ulang berkala, distribusi + tanda
 * terima baca per unit, dan paket bukti akreditasi per bab. Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

export type DocStatus = 'draf' | 'telaah' | 'disetujui' | 'terbit' | 'usang';

export const DOC_FLOW: readonly DocStatus[] = ['draf', 'telaah', 'disetujui', 'terbit'];

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draf: 'Draf',
  telaah: 'Telaah',
  disetujui: 'Disetujui',
  terbit: 'Terbit',
  usang: 'Tidak berlaku',
};

export interface RegDoc {
  id: string;
  code: string;
  title: string;
  kind: 'Kebijakan' | 'Pedoman' | 'Panduan' | 'SPO';
  version: number;
  status: DocStatus;
  owner: string;
  author: string;
  /** Tanggal terbit `YYYY-MM-DD` (null bila belum terbit). */
  publishedAt: string | null;
  /** Tanggal tinjau ulang `YYYY-MM-DD` (terbit + 3 tahun). */
  reviewDue: string | null;
}

const DAY_MS = 86_400_000;
const day = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

export const REVIEW_WARN_DAYS = 60;
export const REVIEW_YEARS = 3;

export function reviewStatus(
  reviewDue: string | null,
  today: string,
): { status: 'aman' | 'segera' | 'lewat'; days: number | null } {
  if (!reviewDue) return { status: 'aman', days: null };
  const days = day(reviewDue) - day(today);
  if (days < 0) return { status: 'lewat', days };
  return { status: days <= REVIEW_WARN_DAYS ? 'segera' : 'aman', days };
}

export function addYears(iso: string, years: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split('-').map(Number);
  return `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Status berikutnya dalam alur (null bila sudah terbit/usang). */
export function nextStatus(s: DocStatus): DocStatus | null {
  const i = DOC_FLOW.indexOf(s);
  return i >= 0 && i < DOC_FLOW.length - 1 ? (DOC_FLOW[i + 1] ?? null) : null;
}

/** Penyetuju harus berbeda dari penyusun; telaah wajib catatan. */
export function docApproveBlock(author: string, approver: string | null): string | null {
  if (!approver) return 'Pilih penyetuju.';
  return approver === author ? 'Penyetuju harus berbeda dari penyusun dokumen.' : null;
}

/**
 * Terbitkan versi `id`: versi itu terbit (tinjau ulang + 3 tahun), versi terbit lain dengan kode sama menjadi usang.
 */
export function publish(docs: readonly RegDoc[], id: string, today: string): RegDoc[] {
  const target = docs.find((d) => d.id === id);
  if (!target) return [...docs];
  return docs.map((d) => {
    if (d.id === id)
      return { ...d, status: 'terbit', publishedAt: today, reviewDue: addYears(today, REVIEW_YEARS) };
    if (d.code === target.code && d.status === 'terbit') return { ...d, status: 'usang' };
    return d;
  });
}

/** Persentase bulat; null bila penyebut nol. */
export function pct(n: number, total: number): number | null {
  return total > 0 ? Math.round((n / total) * 100) : null;
}
