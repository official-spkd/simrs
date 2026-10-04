import 'server-only';
import {
  FORM_CATEGORIES,
  FORM_DEFINITION_STATUSES,
  type FormCategory,
  formSchemaSchema,
} from '@simrs/shared';
import { z } from 'zod';

/** Bentuk respons API form engine (P07) yang diterima web; respons di luar bentuk ini ditolak (BFF). */

const status = z.enum(FORM_DEFINITION_STATUSES);
const category = z.enum(Object.keys(FORM_CATEGORIES) as [FormCategory, ...FormCategory[]]);

export const formListSchema = z.array(
  z.object({
    code: z.string(),
    title: z.string(),
    category,
    published: z.object({ version: z.number().int(), publishedAt: z.string().nullable() }).nullable(),
    draft: z.object({ version: z.number().int(), status }).nullable(),
    versionCount: z.number().int(),
    updatedAt: z.string(),
  }),
);
export type FormListItem = z.infer<typeof formListSchema>[number];

export const definitionSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number().int(),
  title: z.string(),
  category,
  status,
  schema: formSchemaSchema,
  writeRoles: z.array(z.string()),
  changeNote: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable(),
  submittedBy: z.string().nullable(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type Definition = z.infer<typeof definitionSchema>;

export const formDetailSchema = z.object({
  code: z.string(),
  published: definitionSchema.nullable(),
  draft: definitionSchema.nullable(),
  history: z.array(
    z.object({
      version: z.number().int(),
      status,
      changeNote: z.string(),
      createdAt: z.string(),
      publishedAt: z.string().nullable(),
      publishedBy: z.string().nullable(),
    }),
  ),
});
export type FormDetail = z.infer<typeof formDetailSchema>;
