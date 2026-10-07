import { z } from 'zod';
import { allFields, type CreateFormDefinitionInput, type FormSchema } from '../forms';
import { clinicalAuthorSchema, clinicalEntryMetaSchema, SAFETY_REASON_MIN } from './klinis';

/**
 * K11 · Persetujuan/penolakan tindakan di tablet (fase 3 potongan 3.7, keputusan fase 3 no. 2 dan 20, ADR-0058) dan
 * edukasi pasien (lewat formulir P07). Alur: draf dari templat P07 (`consent_drafts`, bukan rekam medis) → tanda
 * tangan pasien/wali + saksi keluarga (gambar PNG unggahan biner ADR-0020 atau ketik nama) → atestasi saksi petugas
 * (sesi petugas itu sendiri) → final oleh dokter (`consent.sign`) = entri `consents` + PDF bertanda tangan + TTE
 * dokter pemberi penjelasan (ADR-0029), atau penolakan beralasan (juga PDF + TTE). Pencabutan = entri baru `dicabut`
 * (addendum atas persetujuan final; versi ber-TTE tidak bisa digantikan, ADR-0028 butir 4), juga dengan PDF + TTE.
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
              { value: 'tindakan', label: 'Tindakan yang direncanakan: manfaat, risiko, alternatif' },
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

/**
 * Syarat final persetujuan (sama dengan layar Edukasi mode demo, `consentReady`): isian P07 `edukasi_terintegrasi`
 * terkini di kunjungan itu yang memuat topik `tindakan` harus berevaluasi `paham`. Edukasi ulang terbaru menggantikan
 * evaluasi sebelumnya. Penolakan tindakan tidak terkena syarat ini.
 */
export const CONSENT_EDUCATION_FORM = EDUCATION_FORM_SAMPLE.code;
export const CONSENT_EDUCATION_TOPIC = 'tindakan';

/** Formulir edukasi yang bisa memenuhi syarat final: punya opsi topik `tindakan` dan evaluasi `paham`. */
export function educationFormSupportsConsent(schema: FormSchema): boolean {
  const fields = allFields(schema);
  const has = (key: string, value: string) =>
    fields.some((f) => f.key === key && (f.options ?? []).some((o) => o.value === value));
  return has('topik', CONSENT_EDUCATION_TOPIC) && has('evaluasi', 'paham');
}

/** Isian edukasi (urut waktu naik) → apakah edukasi tindakan terkini terverifikasi paham. */
export function consentEducationReady(responses: ReadonlyArray<{ answers: unknown }>): boolean {
  let latest: unknown = undefined;
  for (const r of responses) {
    const a = r.answers as { topik?: unknown; evaluasi?: unknown } | null;
    if (Array.isArray(a?.topik) && a.topik.includes(CONSENT_EDUCATION_TOPIC)) latest = a.evaluasi;
  }
  return latest === 'paham';
}

/** Pemberi persetujuan: pasien sendiri (kompeten) atau wali/keluarga terdekat. */
export const CONSENT_SIGNER_KINDS = ['pasien', 'wali'] as const;
export type ConsentSignerKind = (typeof CONSENT_SIGNER_KINDS)[number];
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

/** Batas ukuran PNG tanda tangan (unggahan biner ke draf). */
export const CONSENT_SIGNATURE_MAX_BYTES = 512 * 1024;
/** Atestasi saksi petugas berlaku sekian menit sampai finalisasi (lewat dari itu saksi beratestasi ulang). */
export const CONSENT_WITNESS_VALID_MINUTES = 30;

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

const draftContentFields = {
  procedure: z.string().trim().min(1).max(200),
  signerKind: z.enum(CONSENT_SIGNER_KINDS),
  /** Isian templat: ketujuh kunci `CONSENT_INFORMATION_KEYS` wajib terisi (diperiksa terhadap templat terbit). */
  information: z.record(z.string(), z.string().trim().max(2000)),
  /** Waktu penjelasan; null = dipakai waktu tanda tangan pasien/wali saat final. */
  explainedAt: instant.nullable(),
};

/**
 * `POST /api/v1/encounters/:id/consent-drafts` (izin `consent.write`: dokter, perawat, bidan): draf baru dari templat
 * P07 terbit. Draf bukan rekam medis; isinya bisa diubah sampai difinalkan, ditolak, atau dibatalkan.
 */
export const consentDraftCreateInputSchema = z.strictObject({
  templateCode: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  ...draftContentFields,
});
export type ConsentDraftCreateInput = z.infer<typeof consentDraftCreateInputSchema>;

/** `PUT /api/v1/consents/drafts/:id` (`consent.write`): ganti isi draf. Tanda tangan + atestasi saksi dihapus. */
export const consentDraftUpdateInputSchema = z.strictObject(draftContentFields);
export type ConsentDraftUpdateInput = z.infer<typeof consentDraftUpdateInputSchema>;

/**
 * `PUT /api/v1/consents/drafts/:id/signatures` (`consent.write`, di tablet): pasien/wali menyatakan memahami ketujuh
 * butir (`acknowledged` = ketujuh kunci) lalu menandatangani; saksi keluarga opsional. Atestasi saksi petugas
 * sebelumnya dihapus (saksi menyaksikan penandatanganan yang berlaku).
 */
export const consentDraftSignaturesInputSchema = z
  .strictObject({
    acknowledged: z.array(
      z.enum(CONSENT_INFORMATION_KEYS as [ConsentInformationKey, ...ConsentInformationKey[]]),
    ),
    signer: consentSignatureInputSchema,
    familyWitness: consentSignatureInputSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.familyWitness && !v.familyWitness.relation) {
      ctx.addIssue({
        code: 'custom',
        path: ['familyWitness', 'relation'],
        message: 'Hubungan saksi wajib diisi.',
      });
    }
    if (new Set(v.acknowledged).size !== CONSENT_INFORMATION_KEYS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['acknowledged'],
        message: 'Ketujuh butir informasi wajib dinyatakan dipahami.',
      });
    }
  });
export type ConsentDraftSignaturesInput = z.infer<typeof consentDraftSignaturesInputSchema>;

/** `POST /api/v1/consents/drafts/:id/refuse` (`consent.sign`): penolakan beralasan ≥ 10 → dokumen penolakan + TTE. */
export const consentDraftRefuseInputSchema = z.strictObject({ reason: safetyReason });
export type ConsentDraftRefuseInput = z.infer<typeof consentDraftRefuseInputSchema>;

/** `POST /api/v1/consents/drafts/:id/cancel` (`consent.write`): draf dibuang beralasan (tidak menjadi rekam medis). */
export const consentDraftCancelInputSchema = z.strictObject({ reason: safetyReason });
export type ConsentDraftCancelInput = z.infer<typeof consentDraftCancelInputSchema>;

/** Slot gambar tanda tangan untuk unggahan biner `POST /api/v1/consents/drafts/:id/signature-image?slot=`. */
export const CONSENT_SIGNATURE_SLOTS = ['signer', 'familyWitness'] as const;
export const consentSignatureSlotQuerySchema = z.strictObject({ slot: z.enum(CONSENT_SIGNATURE_SLOTS) });

/**
 * `POST /api/v1/consents/:id/revoke` (`consent.sign`): pencabutan persetujuan final oleh pasien/wali = entri baru
 * `dicabut` (addendum, karena versi ber-TTE terkunci) dengan PDF + TTE.
 */
export const consentRevokeInputSchema = z
  .strictObject({
    reason: safetyReason,
    signerKind: z.enum(CONSENT_SIGNER_KINDS),
    signer: consentSignatureInputSchema,
    familyWitness: consentSignatureInputSchema.nullable(),
  })
  .superRefine((v, ctx) => refineSigner(v, ctx));
export type ConsentRevokeInput = z.infer<typeof consentRevokeInputSchema>;

export const consentTemplateSchema = z.strictObject({
  code: z.string(),
  title: z.string(),
  version: z.int().min(1),
  items: z.array(z.strictObject({ key: z.string(), label: z.string() })),
});
export type ConsentTemplate = z.infer<typeof consentTemplateSchema>;

const signatureView = z.strictObject({
  name: z.string(),
  relation: z.string().nullable(),
  method: z.enum(['goresan', 'nama']),
  imageDocumentId: uuid.nullable(),
});
const person = z.strictObject({ userId: uuid, nama: z.string() });

export const CONSENT_DRAFT_STATUSES = ['draf', 'final', 'ditolak', 'batal'] as const;
export type ConsentDraftStatus = (typeof CONSENT_DRAFT_STATUSES)[number];

/** Draf persetujuan (jawaban API; dibaca tablet). `missing` = syarat final yang belum terpenuhi. */
export const consentDraftSchema = z.strictObject({
  id: uuid,
  patientId: uuid,
  encounterId: uuid,
  templateCode: z.string(),
  templateTitle: z.string(),
  procedure: z.string(),
  signerKind: z.enum(CONSENT_SIGNER_KINDS),
  information: z.array(z.strictObject({ key: z.string(), title: z.string(), body: z.string() })),
  explainedAt: instant.nullable(),
  signer: signatureView.nullable(),
  familyWitness: signatureView.nullable(),
  signedAt: instant.nullable(),
  staffWitness: person.extend({ attestedAt: instant, expiresAt: instant }).nullable(),
  status: z.enum(CONSENT_DRAFT_STATUSES),
  missing: z.array(z.enum(['edukasi_tindakan', 'tanda_tangan', 'saksi_petugas', 'saksi_kedaluwarsa'])),
  consentId: uuid.nullable(),
  cancelReason: z.string().nullable(),
  createdBy: person,
  createdAt: instant,
  updatedAt: instant,
  closedAt: instant.nullable(),
  closedBy: person.nullable(),
});
export type ConsentDraft = z.infer<typeof consentDraftSchema>;

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
