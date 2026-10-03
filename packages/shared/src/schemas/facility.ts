import { z } from 'zod';

/** P01 · Skema validasi struktur faskes (dipakai API dan web). Batasan yang sama ada sebagai CHECK di database. */
export const FACILITY_CODE = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/, 'Kode 1–30 karakter: huruf kapital, angka, strip');

const NAME = z.string().trim().min(2, 'Nama minimal 2 karakter').max(120);

export const UNIT_KINDS = [
  'instalasi',
  'poli',
  'igd',
  'rawat_inap',
  'penunjang',
  'farmasi',
  'kamar_operasi',
  'administrasi',
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const LOCATION_KINDS = ['ruang', 'kamar', 'bed'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const CARE_CLASSES = [
  'vvip',
  'vip',
  'kelas_1',
  'kelas_2',
  'kelas_3',
  'icu',
  'hcu',
  'nicu',
  'picu',
  'isolasi',
  'tanpa_kelas',
] as const;
export type CareClass = (typeof CARE_CLASSES)[number];

const atLeastOne = <T extends Record<string, unknown>>(v: T) => Object.values(v).some((x) => x !== undefined);

export const createFacilitySchema = z.strictObject({
  code: FACILITY_CODE,
  name: NAME,
  kemenkesCode: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
});
export const updateFacilitySchema = z
  .strictObject({
    name: NAME.optional(),
    kemenkesCode: z.string().trim().max(20).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, 'Minimal satu field diubah');

export const createUnitSchema = z.strictObject({
  facilityId: z.uuid(),
  parentId: z.uuid().optional(),
  code: FACILITY_CODE,
  name: NAME,
  kind: z.enum(UNIT_KINDS),
});
export const updateUnitSchema = z
  .strictObject({
    name: NAME.optional(),
    parentId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, 'Minimal satu field diubah');

export const createLocationSchema = z.strictObject({
  unitId: z.uuid(),
  parentId: z.uuid().optional(),
  kind: z.enum(LOCATION_KINDS),
  code: FACILITY_CODE,
  name: NAME,
  careClass: z.enum(CARE_CLASSES).optional(),
  satusehatLocationId: z.string().trim().max(64).optional(),
});
export const updateLocationSchema = z
  .strictObject({
    name: NAME.optional(),
    careClass: z.enum(CARE_CLASSES).nullable().optional(),
    satusehatLocationId: z.string().trim().max(64).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, 'Minimal satu field diubah');

/** Query daftar berpaginasi kursor (UUID v7 → urut waktu dibuat). */
export const listQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});

export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;
export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
