import { z } from 'zod';

/**
 * P08 · Dokumen pasien (lampiran foto/scan, hasil, surat) dan tanda tangan elektronik (TTE). Berkas disimpan di
 * penyimpanan objek dengan nama acak; database menyimpan metadata + SHA-256 isi berkas. Dokumen tidak pernah
 * diubah: salah unggah ditandai batal beralasan, dokumen bertanda tangan dikunci (ADR-0020).
 */

export const DOCUMENT_KINDS = {
  lampiran: 'Lampiran (foto/scan)',
  hasil: 'Hasil pemeriksaan',
  surat: 'Surat',
  resume: 'Resume',
  consent: 'Persetujuan',
  lainnya: 'Lainnya',
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
export const DOCUMENT_KIND_IDS = Object.keys(DOCUMENT_KINDS) as [DocumentKind, ...DocumentKind[]];

/** Batas ukuran unggahan (byte). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Jenis berkas yang diterima, dikenali dari isi (magic bytes), BUKAN dari nama berkas atau Content-Type kiriman
 * klien. SVG/HTML/Office ditolak: bisa memuat skrip atau makro.
 */
export const DOCUMENT_TYPES = {
  'application/pdf': { ext: 'pdf', label: 'PDF', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  'image/png': { ext: 'png', label: 'PNG', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/jpeg': { ext: 'jpg', label: 'JPEG', magic: [0xff, 0xd8, 0xff] },
} as const;
export type DocumentMime = keyof typeof DOCUMENT_TYPES;

export function detectDocumentType(bytes: Uint8Array): DocumentMime | null {
  for (const [mime, t] of Object.entries(DOCUMENT_TYPES) as Array<
    [DocumentMime, { magic: readonly number[] }]
  >) {
    if (bytes.length >= t.magic.length && t.magic.every((b, i) => bytes[i] === b)) return mime;
  }
  return null;
}

/**
 * Nama berkas untuk tampilan dan unduhan saja (penyimpanan memakai kunci acak): tanpa path, karakter kendali,
 * dan karakter yang bermasalah di header/OS; maks. 120 karakter; ekstensi mengikuti jenis berkas sebenarnya.
 */
export function sanitizeFileName(name: string, mime: DocumentMime): string {
  const base =
    name
      .split(/[\\/]/)
      .pop()
      ?.normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}"*:<>?|]/gu, '')
      .replace(/\.[A-Za-z0-9]{1,5}$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 110) ?? '';
  return `${base || 'dokumen'}.${DOCUMENT_TYPES[mime].ext}`;
}

export const uploadDocumentSchema = z.strictObject({
  kind: z.enum(DOCUMENT_KIND_IDS, 'Pilih jenis dokumen'),
  title: z.string().trim().min(3, 'Judul minimal 3 karakter').max(200),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const voidDocumentSchema = z.strictObject({
  reason: z.string().trim().min(10, 'Alasan minimal 10 karakter').max(500),
});

/**
 * Bentuk jawaban dokumen pasien (`GET /patients/:id/documents`, `GET /documents/:id`, unggah, batal, minta TTE);
 * dipakai BFF web untuk memvalidasi respons API (komponen dokumen pasien klinis, utang P08 fase 3 · 3.8).
 */
export const patientDocumentSchema = z.strictObject({
  id: z.uuid(),
  patientId: z.uuid(),
  kind: z.enum(DOCUMENT_KIND_IDS),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.int().min(0),
  sha256: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string().nullable(),
  voided: z
    .strictObject({
      at: z.iso.datetime({ offset: true }),
      by: z.string().nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  signatures: z.array(
    z.strictObject({
      id: z.uuid(),
      signer: z.string().nullable(),
      status: z.enum(['pending', 'signed', 'failed']),
      requestedAt: z.iso.datetime({ offset: true }),
      signedAt: z.iso.datetime({ offset: true }).nullable(),
      certificate: z.string().nullable(),
      verifyUrl: z.string(),
    }),
  ),
});
export type PatientDocumentView = z.infer<typeof patientDocumentSchema>;

// ---------------------------------------------------------------------------------------------------------
// TTE (P08 → I05 penyelenggara sertifikasi elektronik; lokal: apps/mock `/tte/sign`)
// ---------------------------------------------------------------------------------------------------------

export const TTE_SIGN_OPERATION = 'tte.sign';

export const SIGNATURE_STATUSES = ['pending', 'signed', 'failed'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const tteSignRequestSchema = z.strictObject({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  signerId: z.string().min(1).max(200),
});
export type TteSignRequest = z.infer<typeof tteSignRequestSchema>;

export const tteSignResponseSchema = z.object({
  signatureId: z.string().min(1).max(200),
  signedAt: z.iso.datetime(),
  certificate: z.string().min(1).max(1000),
  signature: z.string().min(1).max(10_000),
});

/**
 * Kode verifikasi pada QR dokumen: `sv1.<tenantId>.<rahasia 256 bit base64url>`. Tenant di dalam kode agar
 * halaman verifikasi publik bisa mencari tanpa login.
 */
export const VERIFY_CODE_PATTERN =
  /^sv1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;

export function parseVerifyCode(code: string): { tenantId: string } | null {
  const m = VERIFY_CODE_PATTERN.exec(code);
  return m?.[1] ? { tenantId: m[1] } : null;
}

export const verifyPath = (code: string) => `/verifikasi/${code}`;
