import { z } from 'zod';

/**
 * Isi dokumen klinis untuk PDF (ADR-0029). Semua nilai berasal dari server (data rekam medis yang sudah final), bukan
 * dari klien; skema ini menjaga batas ukuran dan bentuk sebelum dirender. Waktu terbit (`issuedAt`) wajib dari
 * pemanggil: renderer tidak pernah membaca jam, sehingga isi yang sama selalu menghasilkan berkas (dan hash) yang sama.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

const fieldRow = z.strictObject({ label: text(80), value: z.string().trim().max(2000) });

export const pdfBlockSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('paragraph'), text: z.string().trim().max(20_000) }),
  z.strictObject({ kind: z.literal('fields'), rows: z.array(fieldRow).min(1).max(100) }),
  z.strictObject({ kind: z.literal('list'), items: z.array(text(2000)).min(1).max(200) }),
  z
    .strictObject({
      kind: z.literal('table'),
      columns: z.array(text(60)).min(1).max(8),
      /** Lebar relatif kolom (bawaan sama rata). */
      widths: z.array(z.number().positive().max(100)).max(8).optional(),
      rows: z.array(z.array(z.string().trim().max(1000)).max(8)).max(300),
    })
    .refine((t) => t.rows.every((r) => r.length === t.columns.length), 'Jumlah sel tiap baris = jumlah kolom')
    .refine((t) => !t.widths || t.widths.length === t.columns.length, 'Jumlah lebar = jumlah kolom'),
]);
export type PdfBlock = z.infer<typeof pdfBlockSchema>;

export const PATIENT_SEXES = ['male', 'female', 'unknown'] as const;

export const clinicalPdfInputSchema = z.strictObject({
  /** Kop RS. */
  hospital: z.strictObject({
    name: text(200),
    /** Nama fasilitas/unit di bawah nama RS (mis. kampus atau instalasi). */
    unit: optionalText(200),
    address: optionalText(300),
    contact: optionalText(200),
  }),
  document: z.strictObject({
    title: text(200),
    /** Nomor dokumen dari layanan penomoran (bila ada). */
    number: optionalText(60),
    /** Waktu terbit (ISO 8601) dari pemanggil; tampil WIB dan menjadi tanggal metadata PDF. */
    issuedAt: z.iso.datetime({ offset: true }),
  }),
  patient: z.strictObject({
    name: text(200),
    mrn: text(40),
    /** `YYYY-MM-DD`; null bila tidak diketahui. */
    birthDate: z.iso.date().nullable(),
    sex: z.enum(PATIENT_SEXES),
    /** Baris identitas tambahan (kunjungan, ruang, penjamin, DPJP). */
    extra: z.array(fieldRow).max(10).default([]),
  }),
  sections: z
    .array(z.strictObject({ title: text(200), blocks: z.array(pdfBlockSchema).min(1).max(100) }))
    .min(1)
    .max(60),
  signatures: z
    .array(
      z.strictObject({
        /** Peran penanda tangan, mis. "Dokter penanggung jawab pelayanan (DPJP)". */
        role: text(120),
        name: text(200),
        /** Keterangan di bawah nama (NIP/SIP, atau "Pasien", "Saksi"). */
        caption: optionalText(200),
        /** URL verifikasi publik (QR); diisi untuk TTE tersertifikasi (ADR-0020). */
        verifyUrl: z
          .url({ protocol: /^https?$/ })
          .max(300)
          .nullish(),
      }),
    )
    .max(6)
    .default([]),
});
export type ClinicalPdfInput = z.input<typeof clinicalPdfInputSchema>;
export type ClinicalPdfContent = z.output<typeof clinicalPdfInputSchema>;
