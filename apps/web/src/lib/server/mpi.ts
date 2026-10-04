import 'server-only';
import { MATCH_STATUSES, MERGE_ATTRIBUTES } from '@simrs/shared';
import { z } from 'zod';

/** Bentuk respons API MPI (P05) yang diterima web; respons di luar bentuk ini ditolak (BFF, ADR-0013). */

const person = z.object({ id: z.uuid(), mrn: z.string(), name: z.string() });
const severity = z.enum(['tinggi', 'sedang', 'rendah']);
const status = z.enum(MATCH_STATUSES);
const attribute = z.enum(MERGE_ATTRIBUTES);

export const matchItemSchema = z.object({
  id: z.uuid(),
  status,
  score: z.number().int(),
  severity,
  reasons: z.array(z.string()),
  summary: z.string(),
  detectedAt: z.string(),
  decidedAt: z.string().nullable(),
  a: person,
  b: person,
});
export type MatchItem = z.infer<typeof matchItemSchema>;

export const matchListSchema = z.object({ openCount: z.number().int(), items: z.array(matchItemSchema) });

export const compareRowSchema = z.object({
  attribute,
  label: z.string(),
  a: z.string().nullable(),
  b: z.string().nullable(),
  match: z.enum(['sama', 'mirip', 'beda', 'kosong']),
});
export type CompareRow = z.infer<typeof compareRowSchema>;

export const compareSchema = z.object({
  id: z.uuid(),
  status,
  score: z.number().int(),
  severity,
  reasons: z.array(z.string()),
  summary: z.string(),
  detectedAt: z.string(),
  a: person.extend({ status: z.string() }),
  b: person.extend({ status: z.string() }),
  rows: z.array(compareRowSchema),
  impact: z.array(z.object({ n: z.number().int(), label: z.string() })),
  decision: z.object({ at: z.string(), by: z.string().nullable(), reason: z.string().nullable() }).nullable(),
  link: z
    .object({
      id: z.uuid(),
      mergedAt: z.string(),
      mergedBy: z.string().nullable(),
      reason: z.string(),
      taken: z.array(attribute),
      undoUntil: z.string(),
      undoable: z.boolean(),
      undoneAt: z.string().nullable(),
      undoneBy: z.string().nullable(),
      undoReason: z.string().nullable(),
    })
    .nullable(),
});
export type Comparison = z.infer<typeof compareSchema>;

export const mergeResultSchema = z.object({
  linkId: z.uuid(),
  survivor: z.object({ id: z.uuid(), mrn: z.string() }),
  merged: z.object({ id: z.uuid(), mrn: z.string() }),
  taken: z.array(attribute),
  undoUntil: z.string(),
});

export const undoResultSchema = z.object({ restored: z.array(attribute), kept: z.array(attribute) });
