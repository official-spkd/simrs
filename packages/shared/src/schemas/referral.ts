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
 * F07 Rujukan + surat F06 (SPRI, surat kontrol) dalam satu tabel `referrals` berjenis (rencana fase 2 potongan 7).
 * Nama jenis/status mengikuti CHECK `referrals_valid` (migrasi 0b); `spri`, `pending`, dan nomor kosong sampai BPJS
 * memberi nomor ditambahkan migrasi susulan 0b.
 * Yang dikirim ke BPJS lewat outbox: rujukan keluar/balik (`bpjs.vclaim.rujukan.insert`), surat kontrol
 * (`bpjs.vclaim.rencanakontrol.insert`), SPRI (`bpjs.vclaim.spri.insert`); payload hanya `referralId`.
 * Izin: `referral.read|write`; SPRI dan surat kontrol juga `referral.write` (dibuat dari kunjungan oleh petugas
 * atau DPJP lewat layar klinis fase 3).
 */

const isoDateTime = z.iso.datetime({ offset: true });
const NAME = z.string().trim().min(2).max(160);

/**
 * Jenis (`referrals.kind`): rujukan masuk dari FKTP / RS lain, surat kontrol, rujukan keluar, rujukan internal
 * antarpoli, dan SPRI. Tampilan meja pendaftaran memakai subset `REFERRAL_KINDS` (schemas/front-office.ts).
 */
export const REFERRAL_DOC_KINDS = [
  'rujukan-fktp',
  'rujukan-rs',
  'surat-kontrol',
  'rujukan-keluar',
  'rujukan-internal',
  'spri',
] as const;
export type ReferralDocKind = (typeof REFERRAL_DOC_KINDS)[number];
export const REFERRAL_DOC_KIND_LABEL: Record<ReferralDocKind, string> = {
  'rujukan-fktp': 'Rujukan FKTP',
  'rujukan-rs': 'Rujukan RS lain',
  'surat-kontrol': 'Surat kontrol',
  'rujukan-keluar': 'Rujukan keluar',
  'rujukan-internal': 'Rujukan internal antarpoli',
  spri: 'Surat perintah rawat inap (SPRI)',
};

/**
 * `pending` menunggu nomor dari BPJS (surat kontrol, SPRI, rujukan keluar; `number` masih kosong); `active` berlaku;
 * `used` sudah dipakai kunjungan/SEP; `expired`; `cancelled`.
 */
export const REFERRAL_STATUSES = ['pending', 'active', 'used', 'expired', 'cancelled'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** Kode PPK/faskes BPJS 8 karakter (mis. `0301R001`). */
export const PPK_CODE_PATTERN = /^[0-9A-Z]{8}$/;
/** Kode poli BPJS (3 huruf, mis. `INT`, `JAN`), dipetakan dari poli RS lewat `external_ids`. */
export const BPJS_POLI_CODE_PATTERN = /^[A-Z]{3}$/;

export const referralRecordSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(REFERRAL_DOC_KINDS),
  status: z.enum(REFERRAL_STATUSES),
  /** Nomor BPJS/RS; null selama `pending`. */
  number: z.string().min(3).max(40).nullable(),
  patientId: z.uuid(),
  /** Kunjungan asal (keluar, internal, kontrol, SPRI) atau yang memakai rujukan masuk ini. */
  encounterId: z.uuid().nullable(),
  /** Kode PPK perujuk (masuk) atau tujuan (keluar). */
  ppkCode: z.string().max(20).nullable(),
  /** Faskes perujuk/tujuan atau poli asal surat kontrol. */
  facilityName: z.string().min(1).max(160),
  /** Poli tujuan di RS ini. */
  targetServiceId: z.uuid().nullable(),
  practitionerId: z.uuid().nullable(),
  diagnosis: icd10CodingSchema.nullable(),
  issuedOn: serviceDateSchema,
  validUntil: serviceDateSchema.nullable(),
  /** Kunjungan ke- (rujukan FKTP berlaku untuk beberapa kunjungan). */
  visitNo: z.number().int().min(1).nullable(),
  /** Status kirim ke BPJS (surat kontrol, SPRI, rujukan keluar); `not_required` untuk rujukan masuk/internal. */
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
    kind: z.enum(['rujukan-fktp', 'rujukan-rs']),
    patientId: z.uuid(),
    number: bpjsReferenceNumberSchema,
    facilityName: NAME,
    ppkCode: z.string().regex(PPK_CODE_PATTERN).optional(),
    targetServiceId: z.uuid().optional(),
    diagnosis: icd10CodingSchema,
    issuedOn: serviceDateSchema,
    validUntil: serviceDateSchema,
    visitNo: z.number().int().min(1).max(12).optional(),
  })
  .refine((v) => v.validUntil >= v.issuedOn, {
    message: 'Masa berlaku sebelum tanggal terbit',
    path: ['validUntil'],
  });
export type RecordIncomingReferralInput = z.infer<typeof recordIncomingReferralSchema>;

/** Rujukan keluar ke faskes lain (`rujukan-keluar`). Rawat jalan wajib poli tujuan (kode poli BPJS). */
export const createOutgoingReferralSchema = z
  .strictObject({
    encounterId: z.uuid(),
    destination: z.strictObject({ ppkCode: z.string().regex(PPK_CODE_PATTERN), name: NAME }),
    serviceType: z.enum(['rawat_jalan', 'rawat_inap']),
    bpjsPoliCode: z.string().regex(BPJS_POLI_CODE_PATTERN).optional(),
    diagnosis: icd10CodingSchema,
    plannedDate: serviceDateSchema,
    /** Catatan untuk BPJS (tidak disimpan di baris rujukan). */
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.serviceType === 'rawat_inap' || v.bpjsPoliCode !== undefined, {
    message: 'Rujukan rawat jalan wajib menyebut poli tujuan',
    path: ['bpjsPoliCode'],
  });
export type CreateOutgoingReferralInput = z.infer<typeof createOutgoingReferralSchema>;

/** Rujukan internal antarpoli (`rujukan-internal`, konsul ke poli lain di RS yang sama). */
export const createInternalReferralSchema = z.strictObject({
  encounterId: z.uuid(),
  targetServiceId: z.uuid(),
  practitionerId: z.uuid().optional(),
  diagnosis: icd10CodingSchema.optional(),
  reason: z.string().trim().min(5).max(500),
});
export type CreateInternalReferralInput = z.infer<typeof createInternalReferralSchema>;

/**
 * Surat kontrol (rencana kontrol ke poli) atau SPRI (rencana rawat inap) dari sebuah kunjungan; nomor dari BPJS lewat
 * outbox (`pending` → `active`).
 */
export const createControlLetterSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('surat-kontrol'),
    encounterId: z.uuid(),
    plannedDate: serviceDateSchema,
    /** DPJP tujuan. */
    practitionerId: z.uuid(),
    /** Poli tujuan (layanan antrean). */
    targetServiceId: z.uuid(),
    diagnosis: icd10CodingSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('spri'),
    encounterId: z.uuid(),
    plannedDate: serviceDateSchema,
    practitionerId: z.uuid(),
    /** Unit rawat inap tujuan. */
    unitId: z.uuid(),
    diagnosis: icd10CodingSchema.optional(),
  }),
]);
export type CreateControlLetterInput = z.infer<typeof createControlLetterSchema>;

export const cancelReferralSchema = z.strictObject({ reason: changeReasonSchema });
export type CancelReferralInput = z.infer<typeof cancelReferralSchema>;
