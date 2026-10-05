import { z } from 'zod';
import type { CreateFormDefinitionInput } from '../forms';
import { clinicalAuthorSchema, clinicalEntryMetaSchema, SAFETY_REASON_MIN } from './klinis';

/**
 * K11 · Persetujuan/penolakan tindakan di tablet (fase 3 potongan 3.7, keputusan fase 3 no. 2 dan 20) dan edukasi
 * pasien (lewat formulir P07). Persetujuan dicatat SAAT FINAL (draf pengisian memakai draf klinis); tanda tangan
 * pasien/wali + saksi keluarga (gambar PNG unggahan biner ADR-0020 atau ketik nama) + atestasi saksi petugas (sesi
 * petugas itu sendiri); PDF bertanda tangan + TTE dokter pemberi penjelasan (ADR-0029). Pencabutan = addendum
 * `dicabut` atas persetujuan final (versi ber-TTE tidak bisa digantikan, ADR-0028 butir 4), juga dengan PDF + TTE.
 */

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const safetyReason = z.string().trim().min(SAFETY_REASON_MIN).max(500);

/**
 * Tujuh butir informasi wajib yang dijelaskan sebelum persetujuan (Permenkes 290/2008 pasal 7; urutan tetap). Templat
 * persetujuan di P07 = formulir terbit yang memuat ketujuh kunci ini sebagai isian wajib.
 */
export const CONSENT_INFORMATION_ITEMS = [
  { key: 'diagnosis', label: 'Diagnosis (kerja dan banding)' },
  { key: 'tindakan', label: 'Tindakan yang diusulkan' },
  { key: 'tata_cara', label: 'Tata cara dan tujuan tindakan' },
  { key: 'risiko', label: 'Risiko' },
  { key: 'komplikasi', label: 'Komplikasi yang mungkin terjadi' },
  { key: 'alternatif', label: 'Alternatif tindakan dan risikonya' },
  { key: 'prognosis', label: 'Prognosis' },
] as const;
export const CONSENT_INFORMATION_KEYS = CONSENT_INFORMATION_ITEMS.map((i) => i.key);
export type ConsentInformationKey = (typeof CONSENT_INFORMATION_ITEMS)[number]['key'];

/** Templat persetujuan tindakan umum (contoh seed; RS membuat versinya sendiri di layar Formulir). */
export const CONSENT_TEMPLATE_SAMPLE: CreateFormDefinitionInput = {
  code: 'persetujuan_tindakan',
  title: 'Persetujuan tindakan kedokteran',
  category: 'medis',
  writeRoles: ['dokter'],
  changeNote: 'Templat contoh tujuh butir informasi (Permenkes 290/2008)',
  schema: {
    sections: [
      {
        title: 'Informasi yang dijelaskan dokter',
        description: 'Ketujuh butir wajib dijelaskan dan dipahami pasien/wali sebelum tanda tangan.',
        fields: CONSENT_INFORMATION_ITEMS.map((i) => ({
          key: i.key,
          type: 'textarea' as const,
          label: i.label,
          required: true,
          summary: false,
        })),
      },
    ],
  },
};

/** Edukasi pasien dan keluarga terintegrasi (P07, diisi dengan `encounterId`). */
export const EDUCATION_FORM_SAMPLE: CreateFormDefinitionInput = {
  code: 'edukasi_terintegrasi',
  title: 'Edukasi pasien dan keluarga terintegrasi',
  category: 'umum',
  writeRoles: ['dokter', 'perawat', 'bidan', 'apoteker'],
  changeNote: 'Templat contoh edukasi terintegrasi',
  schema: {
    sections: [
      {
        title: 'Edukasi',
        fields: [
          {
            key: 'topik',
            type: 'multi',
            label: 'Topik edukasi',
            required: true,
            summary: true,
            options: [
              { value: 'penyakit', label: 'Kondisi/penyakit' },
              { value: 'obat', label: 'Obat dan efek samping' },
              { value: 'gizi', label: 'Diet dan gizi' },
              { value: 'nyeri', label: 'Manajemen nyeri' },
              { value: 'rehabilitasi', label: 'Rehabilitasi' },
              { value: 'infeksi', label: 'Pencegahan infeksi' },
              { value: 'alat', label: 'Penggunaan alat medis' },
            ],
          },
          {
            key: 'sasaran',
            type: 'single',
            label: 'Sasaran',
            required: true,
            summary: false,
            options: [
              { value: 'pasien', label: 'Pasien' },
              { value: 'keluarga', label: 'Keluarga/pendamping' },
              { value: 'keduanya', label: 'Pasien dan keluarga' },
            ],
          },
          {
            key: 'evaluasi',
            type: 'single',
            label: 'Evaluasi pemahaman',
            required: true,
            summary: true,
            options: [
              { value: 'paham', label: 'Memahami, bisa mengulang' },
              { value: 'perlu_ulang', label: 'Perlu edukasi ulang' },
            ],
          },
          { key: 'catatan', type: 'textarea', label: 'Catatan', required: false, summary: false },
        ],
      },
    ],
  },
};

/** Pemberi persetujuan: pasien sendiri (kompeten) atau wali/keluarga terdekat. */
export const CONSENT_SIGNER_KINDS = ['pasien', 'wali'] as const;
export const CONSENT_DECISIONS = ['setuju', 'tolak', 'dicabut'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/** Tanda tangan: `goresan` = PNG hasil bantalan (unggahan biner P08), `nama` = ketik nama (aksesibilitas). */
export const consentSignatureInputSchema = z
  .strictObject({
    name: z.string().trim().min(3).max(80),
    relation: z.string().trim().min(1).max(40).nullable(),
    method: z.enum(['goresan', 'nama']),
    imageDocumentId: uuid.nullable(),
  })
  .refine((v) => (v.method === 'goresan') === (v.imageDocumentId !== null), {
    path: ['imageDocumentId'],
    message: 'Tanda tangan goresan wajib berkas gambar; ketik nama tanpa berkas.',
  });
export type ConsentSignatureInput = z.infer<typeof consentSignatureInputSchema>;

const signerFields = {
  signerKind: z.enum(CONSENT_SIGNER_KINDS),
  signer: consentSignatureInputSchema,
  /** Saksi keluarga (opsional). */
  familyWitness: consentSignatureInputSchema.nullable(),
  /** Petugas saksi yang sudah beratestasi lewat `POST /encounters/:id/consent-witness` (≤ 30 menit). */
  staffWitnessUserId: uuid,
};

function refineSigner(
  v: {
    signerKind: string;
    signer: { relation: string | null };
    familyWitness: { relation: string | null } | null;
  },
  ctx: z.RefinementCtx,
) {
  if (v.signerKind === 'wali' && !v.signer.relation) {
    ctx.addIssue({
      code: 'custom',
      path: ['signer', 'relation'],
      message: 'Hubungan wali dengan pasien wajib diisi.',
    });
  }
  if (v.familyWitness && !v.familyWitness.relation) {
    ctx.addIssue({
      code: 'custom',
      path: ['familyWitness', 'relation'],
      message: 'Hubungan saksi wajib diisi.',
    });
  }
}

/**
 * `POST /api/v1/consents` (izin `consent.sign`, hanya dokter): persetujuan atau penolakan final + PDF + TTE dokter.
 * `information` = isian templat (ketujuh kunci wajib). Penolakan wajib alasan ≥ 10 karakter.
 */
export const consentCreateInputSchema = z
  .strictObject({
    encounterId: uuid,
    templateCode: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
    procedure: z.string().trim().min(1).max(200),
    explainedAt: instant,
    information: z.record(z.string(), z.string().trim().max(2000)),
    decision: z.enum(['setuju', 'tolak']),
    refusalReason: z.string().trim().max(500).nullable(),
    ...signerFields,
  })
  .superRefine((v, ctx) => {
    refineSigner(v, ctx);
    if (v.decision === 'tolak' && (v.refusalReason ?? '').length < SAFETY_REASON_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['refusalReason'],
        message: `Penolakan wajib beralasan (minimal ${SAFETY_REASON_MIN} karakter).`,
      });
    }
    if (v.decision === 'setuju' && v.refusalReason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['refusalReason'],
        message: 'Persetujuan tanpa alasan penolakan.',
      });
    }
  });
export type ConsentCreateInput = z.infer<typeof consentCreateInputSchema>;

/** `POST /api/v1/consents/:id/revoke`: pencabutan persetujuan final oleh pasien/wali (addendum `dicabut`). */
export const consentRevokeInputSchema = z
  .strictObject({ reason: safetyReason, ...signerFields })
  .superRefine((v, ctx) => refineSigner(v, ctx));
export type ConsentRevokeInput = z.infer<typeof consentRevokeInputSchema>;

/** `POST /api/v1/encounters/:id/consent-witness`: atestasi saksi petugas (sesi petugas itu), berlaku 30 menit. */
export const consentWitnessInputSchema = z.strictObject({ procedure: z.string().trim().min(1).max(200) });
export type ConsentWitnessInput = z.infer<typeof consentWitnessInputSchema>;
export const CONSENT_WITNESS_VALID_MINUTES = 30;

export const consentWitnessSchema = z.strictObject({
  witnessUserId: uuid,
  procedure: z.string(),
  attestedAt: instant,
  expiresAt: instant,
});

export const consentTemplateSchema = z.strictObject({
  code: z.string(),
  title: z.string(),
  version: z.int().min(1),
  items: z.array(z.strictObject({ key: z.string(), label: z.string() })),
});
export type ConsentTemplate = z.infer<typeof consentTemplateSchema>;

export const consentRecordSchema = clinicalEntryMetaSchema.extend({
  patientId: uuid,
  encounterId: uuid,
  templateCode: z.string().nullable(),
  procedure: z.string(),
  decision: z.enum(CONSENT_DECISIONS),
  /** Status berlaku: persetujuan yang punya addendum `dicabut` final = `dicabut`. */
  effectiveDecision: z.enum(CONSENT_DECISIONS),
  refusalReason: z.string().nullable(),
  information: z.array(z.strictObject({ key: z.string(), title: z.string(), body: z.string() })),
  informer: clinicalAuthorSchema.omit({ peran: true }),
  explainedAt: instant,
  signatures: z.array(
    z.strictObject({
      signerKind: z.enum(['pasien', 'wali', 'saksi_keluarga', 'saksi_petugas']),
      signerName: z.string(),
      relation: z.string().nullable(),
      method: z.enum(['goresan', 'nama']),
      imageDocumentId: uuid.nullable(),
      staffUserId: uuid.nullable(),
      signedAt: instant,
    }),
  ),
  /** PDF bertanda tangan (P08) + status TTE. */
  document: z
    .strictObject({ id: uuid, signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable() })
    .nullable(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
