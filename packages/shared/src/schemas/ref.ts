import { z } from 'zod';
import { REF_CODE_SYSTEM_IDS } from '../terminology';

/** P06 · Parameter pencarian data rujukan (API dan web). */
export const refSearchSchema = z.strictObject({
  system: z.enum(REF_CODE_SYSTEM_IDS),
  q: z.string().trim().min(1, 'Ketik kode atau kata kunci').max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});

export const refRegionsSchema = z.strictObject({
  /** Kode induk; kosong = daftar provinsi. */
  parent: z
    .string()
    .regex(/^[0-9]{2}(\.[0-9]{2}(\.[0-9]{2})?)?$/, 'Kode wilayah induk tidak valid')
    .optional(),
  q: z.string().trim().min(2, 'Ketik minimal 2 huruf').max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type RefSearchQuery = z.infer<typeof refSearchSchema>;
export type RefRegionsQuery = z.infer<typeof refRegionsSchema>;
