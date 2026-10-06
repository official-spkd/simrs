import {
  DOCUMENT_KINDS,
  DOCUMENT_TYPES,
  type DocumentKind,
  type DocumentMime,
  MAX_DOCUMENT_BYTES,
  uploadDocumentSchema,
  voidDocumentSchema,
} from '@simrs/shared';

/**
 * P08 · Dokumen pasien dan TTE (mode presentasi, ADR-0023). Aturan mengikuti kontrak bersama `documents.ts`:
 * jenis berkas PDF/PNG/JPEG, maks. 10 MB, judul 3–200 huruf, batal wajib alasan ≥ 10 huruf, dokumen bertanda
 * tangan terkunci (koreksi lewat addendum). Alur TTE: draf → minta TTE → menunggu penanda tangan → ditandatangani
 * (atau gagal → kirim ulang).
 */

export type DocStatus = 'draft' | 'pending' | 'signed' | 'failed' | 'void';

/** Pasien di pemilih layar Dokumen (banner pasien + DPJP penanda tangan bawaan). */
export interface DocPatient {
  id: string;
  nama: string;
  rm: string;
  jk: 'L' | 'P';
  umur: number;
  tanggalLahir: string;
  alergi: string[];
  penjamin: string;
  dpjp: string;
}

export interface DemoDocument {
  id: string;
  patientId: string;
  kind: DocumentKind;
  title: string;
  mime: DocumentMime;
  sizeBytes: number;
  /** SHA-256 isi berkas (hex). */
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  status: DocStatus;
  /** Lampiran foto/scan tidak perlu TTE. */
  needsSignature: boolean;
  signer?: string;
  requestedAt?: string;
  signedAt?: string;
  failReason?: string;
  voidReason?: string;
  /** Kode verifikasi QR (tampilan demo, bukan `sv1` asli). */
  verifyCode?: string;
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'Belum ditandatangani',
  pending: 'Menunggu TTE',
  signed: 'Ditandatangani',
  failed: 'TTE gagal',
  void: 'Dibatalkan',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Jenis berkas dari ekstensi + tipe kiriman browser (di server dicek dari isi berkas / magic bytes). */
export function mimeOf(name: string, type: string): DocumentMime | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const [mime, t] of Object.entries(DOCUMENT_TYPES) as Array<[DocumentMime, { ext: string }]>) {
    if (type === mime || t.ext === ext || (ext === 'jpeg' && mime === 'image/jpeg')) return mime;
  }
  return null;
}

export type UploadCheck =
  { ok: true; mime: DocumentMime } | { ok: false; field: 'file' | 'title' | 'kind'; message: string };

export function validateUpload(input: {
  kind: string;
  title: string;
  file: { name: string; size: number; type: string } | null;
}): UploadCheck {
  const meta = uploadDocumentSchema.safeParse({ kind: input.kind, title: input.title });
  if (!meta.success) {
    const issue = meta.error.issues[0];
    const field = issue?.path[0] === 'kind' ? 'kind' : 'title';
    return {
      ok: false,
      field,
      message: field === 'kind' ? 'Pilih jenis dokumen' : (issue?.message ?? 'Judul tidak valid'),
    };
  }
  if (!input.file) return { ok: false, field: 'file', message: 'Pilih berkas PDF, PNG, atau JPEG' };
  const mime = mimeOf(input.file.name, input.file.type);
  if (!mime) {
    return {
      ok: false,
      field: 'file',
      message: 'Jenis berkas ditolak. Hanya PDF, PNG, atau JPEG (bukan Office/HTML/SVG).',
    };
  }
  if (input.file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, field: 'file', message: `Berkas ${formatBytes(input.file.size)}; maksimal 10 MB.` };
  }
  if (input.file.size === 0) return { ok: false, field: 'file', message: 'Berkas kosong.' };
  return { ok: true, mime };
}

export type Check = { ok: true } | { ok: false; reason: string };

export function canRequestTte(d: DemoDocument): Check {
  if (!d.needsSignature) return { ok: false, reason: 'Lampiran foto/scan tidak memerlukan TTE.' };
  if (d.status === 'void') return { ok: false, reason: 'Dokumen dibatalkan.' };
  if (d.status === 'signed') return { ok: false, reason: 'Sudah ditandatangani.' };
  if (d.status === 'pending') return { ok: false, reason: 'Permintaan TTE sedang menunggu penanda tangan.' };
  return { ok: true };
}

export function canVoid(d: DemoDocument): Check {
  if (d.status === 'void') return { ok: false, reason: 'Dokumen sudah dibatalkan.' };
  if (d.status === 'signed') {
    return { ok: false, reason: 'Dokumen bertanda tangan terkunci; koreksi lewat addendum.' };
  }
  return { ok: true };
}

export function voidReasonValid(reason: string): boolean {
  return voidDocumentSchema.safeParse({ reason }).success;
}

/** Nama tersamar untuk halaman verifikasi publik: "Ny. E**** W*****". */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .map((w) =>
      /^(Tn|Ny|An|Nn|dr)\.$/i.test(w) ? w : `${w[0] ?? ''}${'*'.repeat(Math.max(0, w.length - 1))}`,
    )
    .join(' ');
}

export const kindLabel = (k: DocumentKind) => DOCUMENT_KINDS[k];

/** Hasil pemeriksaan halaman verifikasi publik: kode dikenal dan hash berkas yang dipindai sama. */
export function verifyDocument(
  docs: readonly DemoDocument[],
  code: string,
  fileHash: string | null,
): { status: 'asli' | 'tidak-cocok' | 'tidak-dikenal' | 'dibatalkan'; doc?: DemoDocument } {
  const doc = docs.find((d) => d.verifyCode === code && d.status !== 'draft');
  if (!doc || doc.status !== 'signed') {
    return doc?.status === 'void' ? { status: 'dibatalkan', doc } : { status: 'tidak-dikenal' };
  }
  if (fileHash !== null && fileHash !== doc.sha256) return { status: 'tidak-cocok', doc };
  return { status: 'asli', doc };
}

/** Hex SHA-256 untuk berkas yang dipilih di browser (Web Crypto). */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
