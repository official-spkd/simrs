import {
  DOCUMENT_KINDS,
  type DocumentKind,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type PatientDocumentView,
} from '@simrs/shared';

/**
 * P08 · Aturan tampilan komponen dokumen pasien di layar klinis (fase 3 · 3.8, ADR-0059). Murni (dipakai komponen
 * klien, Server Action, dan tes); API tetap penegak akhir (izin `documents.*`, ABAC pasien, status dokumen).
 */

/** Jenis yang boleh diunggah klinisi dari layar klinis (resume/persetujuan dibuat modulnya sendiri, ber-TTE). */
export const CLINICAL_UPLOAD_KINDS = [
  'lampiran',
  'hasil',
  'surat',
  'lainnya',
] as const satisfies DocumentKind[];

export const UPLOAD_ACCEPT = Object.keys(DOCUMENT_TYPES).join(',');

export const MIN_VOID_REASON = 10;

export function kindLabel(kind: DocumentKind): string {
  return DOCUMENT_KINDS[kind];
}

/** Ukuran berkas ramah baca (Bahasa Indonesia, desimal koma). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export type SignatureState = 'belum' | 'menunggu' | 'ditandatangani' | 'gagal';

/** Status TTE terkini dokumen (tanda tangan terakhir). */
export function signatureState(doc: Pick<PatientDocumentView, 'signatures'>): SignatureState {
  const last = doc.signatures.at(-1);
  if (!last) return 'belum';
  return last.status === 'signed' ? 'ditandatangani' : last.status === 'failed' ? 'gagal' : 'menunggu';
}

export const SIGNATURE_LABEL: Record<SignatureState, string> = {
  belum: 'Belum ditandatangani',
  menunggu: 'TTE diproses',
  ditandatangani: 'Ber-TTE',
  gagal: 'TTE gagal',
};

/** Alasan tombol "Minta TTE" nonaktif; null = boleh. */
export function signBlocker(
  doc: Pick<PatientDocumentView, 'voided' | 'mimeType' | 'signatures'>,
  canWrite: boolean,
): string | null {
  if (!canWrite) return 'Peran Anda tidak berizin meminta TTE dokumen.';
  if (doc.voided) return 'Dokumen batal tidak ditandatangani.';
  if (doc.mimeType !== 'application/pdf') return 'TTE hanya untuk dokumen PDF.';
  const state = signatureState(doc);
  if (state === 'menunggu') return 'TTE sedang diproses penyelenggara.';
  if (state === 'ditandatangani') return 'Dokumen sudah ber-TTE.';
  return null;
}

/** Alasan tombol "Batalkan" nonaktif; null = boleh. Dokumen ber-TTE dikunci (ADR-0020). */
export function voidBlocker(
  doc: Pick<PatientDocumentView, 'voided' | 'signatures'>,
  canWrite: boolean,
): string | null {
  if (!canWrite) return 'Peran Anda tidak berizin membatalkan dokumen.';
  if (doc.voided) return 'Dokumen sudah dibatalkan.';
  if (doc.signatures.some((s) => s.status !== 'failed'))
    return 'Dokumen ber-TTE terkunci; tidak bisa dibatalkan.';
  return null;
}

/** Validasi unggahan sebelum dikirim (API memeriksa ulang isi berkas). */
export function uploadProblem(file: { size: number; type: string } | null, title: string): string | null {
  if (!file || file.size === 0) return 'Pilih berkas PDF, PNG, atau JPEG.';
  if (file.size > MAX_DOCUMENT_BYTES) return `Berkas maksimal ${MAX_DOCUMENT_BYTES / 1048576} MB.`;
  if (file.type && !(file.type in DOCUMENT_TYPES)) return 'Hanya berkas PDF, PNG, atau JPEG yang diterima.';
  if (title.trim().length < 3) return 'Judul minimal 3 karakter.';
  return null;
}
