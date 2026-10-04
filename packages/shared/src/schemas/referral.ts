import { z } from 'zod';
import {
  bpjsReferenceNumberSchema,
  bpjsSyncSchema,
  changeReasonSchema,
  cursorPageQuerySchema,
  icd10CodingSchema,
  serviceDateSchema,
} from './front-office';

/**
 * F07 Rujukan + surat F06 (SPRI, rencana kontrol) dalam satu tabel `referrals` berjenis (rencana fase 2 potongan 7).
 * Yang dikirim ke BPJS lewat outbox: rujukan keluar/balik (`bpjs.vclaim.rujukan.insert`), surat kontrol
 * (`bpjs.vclaim.rencanakontrol.insert`), SPRI (`bpjs.vclaim.spri.insert`); payload hanya `referralId`.
 * Izin: `referral.read|write`; SPRI dan surat kontrol juga `referral.write` (dibuat dari kunjungan oleh petugas
 * atau DPJP lewat layar klinis fase 3).
 */

const isoDateTime = z.iso.datetime({ offset: true });
const NAME = z.string().trim().min(2).max(160);

export const REFERRAL_DOC_KINDS = [
  'rujukan_masuk',
  'rujukan_keluar',
  'rujukan_balik',
  'rujukan_internal',
  'surat_kontrol',
  'spri',
] as const;
export type ReferralDocKind = (typeof REFERRAL_DOC_KINDS)[number];
export const REFERRAL_DOC_KIND_LABEL: Record<ReferralDocKind, string> = {
  rujukan_masuk: 'Rujukan masuk',
  rujukan_keluar: 'Rujukan keluar',
  rujukan_balik: 'Rujuk balik (PRB)',
  rujukan_internal: 'Rujukan internal antarpoli',
  surat_kontrol: 'Surat kontrol',
  spri: 'Surat perintah rawat inap (SPRI)',
};

/**
 * `draft` belum dikirim; `pending` menunggu nomor BPJS; `issued` berlaku; `used` sudah dipakai kunjungan/SEP (atau
 * kuota kunjungannya habis); `expired`; `cancelled`.
 */
export const REFERRAL_STATUSES = ['draft', 'pending', 'issued', 'used', 'expired', 'cancelled'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** Kode PPK/faskes BPJS 8 karakter (mis. `0301R001`). */
export const PPK_CODE_PATTERN = /^[0-9A-Z]{8}$/;
/** Kode poli BPJS (3 huruf, mis. `INT`, `JAN`), dipetakan dari poli RS lewat `external_ids`. */
export const BPJS_POLI_CODE_PATTERN = /^[A-Z]{3}$/;

export const referralRecordSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(REFERRAL_DOC_KINDS),
  status: z.enum(REFERRAL_STATUSES),
  /** Nomor BPJS/RS; null selama `draft`/`pending`. */
  number: z.string().max(30).nullable(),
  patientId: z.uuid(),
  /** Kunjungan asal (rujukan keluar, internal, kontrol, SPRI); null untuk rujukan masuk. */
  encounterId: z.uuid().nullable(),
  origin: z.strictObject({ name: z.string().min(1).max(160), ppkCode: z.string().nullable() }).nullable(),
  destination: z
    .strictObject({
      name: z.string().min(1).max(160),
      ppkCode: z.string().nullable(),
      unitId: z.uuid().nullable(),
    })
    .nullable(),
  practitionerId: z.uuid().nullable(),
  diagnosis: icd10CodingSchema.nullable(),
  issuedAt: serviceDateSchema.nullable(),
  validUntil: serviceDateSchema.nullable(),
  /** Tanggal rencana kontrol / rawat inap. */
  plannedDate: serviceDateSchema.nullable(),
  /** Rujukan FKTP berlaku untuk beberapa kunjungan. */
  visitLimit: z.number().int().min(1).nullable(),
  visitsUsed: z.number().int().min(0),
  note: z.string().max(500).nullable(),
  sync: bpjsSyncSchema,
  createdAt: isoDateTime,
});
export type ReferralRecord = z.infer<typeof referralRecordSchema>;

export const referralListQuerySchema = z.strictObject({
  ...cursorPageQuerySchema.shape,
  patientId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
  kind: z.enum(REFERRAL_DOC_KINDS).optional(),
  status: z.enum(REFERRAL_STATUSES).optional(),
});

/** Catat rujukan masuk manual (mis. rujukan kertas/non-BPJS); rujukan BPJS diambil lewat lookup. */
export const recordIncomingReferralSchema = z
  .strictObject({
    patientId: z.uuid(),
    number: bpjsReferenceNumberSchema,
    originName: NAME,
    ppkCode: z.string().regex(PPK_CODE_PATTERN).optional(),
    diagnosis: icd10CodingSchema,
    issuedAt: serviceDateSchema,
    validUntil: serviceDateSchema,
    visitLimit: z.number().int().min(1).max(12).optional(),
  })
  .refine((v) => v.validUntil >= v.issuedAt, {
    message: 'Masa berlaku sebelum tanggal terbit',
    path: ['validUntil'],
  });
export type RecordIncomingReferralInput = z.infer<typeof recordIncomingReferralSchema>;

/** Rujukan keluar ke RS lain atau rujuk balik ke FKTP. Rawat jalan wajib poli tujuan (kode poli BPJS). */
export const createOutgoingReferralSchema = z
  .strictObject({
    kind: z.enum(['rujukan_keluar', 'rujukan_balik']).default('rujukan_keluar'),
    encounterId: z.uuid(),
    destination: z.strictObject({ ppkCode: z.string().regex(PPK_CODE_PATTERN), name: NAME }),
    serviceType: z.enum(['rawat_jalan', 'rawat_inap']),
    bpjsPoliCode: z.string().regex(BPJS_POLI_CODE_PATTERN).optional(),
    diagnosis: icd10CodingSchema,
    plannedDate: serviceDateSchema,
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.serviceType === 'rawat_inap' || v.bpjsPoliCode !== undefined, {
    message: 'Rujukan rawat jalan wajib menyebut poli tujuan',
    path: ['bpjsPoliCode'],
  });
export type CreateOutgoingReferralInput = z.infer<typeof createOutgoingReferralSchema>;

/** Rujukan internal antarpoli (konsul ke unit lain di RS yang sama). */
export const createInternalReferralSchema = z.strictObject({
  encounterId: z.uuid(),
  toUnitId: z.uuid(),
  toPractitionerId: z.uuid().optional(),
  diagnosis: icd10CodingSchema.optional(),
  reason: z.string().trim().min(5).max(500),
});
export type CreateInternalReferralInput = z.infer<typeof createInternalReferralSchema>;

/** Surat kontrol (rencana kontrol pasca-rawat jalan) atau SPRI (rencana rawat inap) dari sebuah kunjungan. */
export const createControlLetterSchema = z.strictObject({
  kind: z.enum(['surat_kontrol', 'spri']),
  encounterId: z.uuid(),
  plannedDate: serviceDateSchema,
  /** DPJP tujuan. */
  practitionerId: z.uuid(),
  /** Poli (surat kontrol) atau unit rawat inap (SPRI). */
  unitId: z.uuid(),
  diagnosis: icd10CodingSchema.optional(),
  note: z.string().trim().max(500).optional(),
});
export type CreateControlLetterInput = z.infer<typeof createControlLetterSchema>;

export const cancelReferralSchema = z.strictObject({ reason: changeReasonSchema });
export type CancelReferralInput = z.infer<typeof cancelReferralSchema>;
