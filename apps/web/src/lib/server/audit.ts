import 'server-only';
import { FORM_RESPONSE_STATUSES } from '@simrs/shared';
import { z } from 'zod';

/** Bentuk respons API layar Audit (P04) dan akses darurat (P03). Respons di luar bentuk ini ditolak. */

const actorSchema = z.object({ id: z.uuid(), displayName: z.string(), username: z.string() }).nullable();
const personSchema = z.object({ id: z.uuid(), displayName: z.string() }).nullable();

export const auditEventSchema = z.object({
  seq: z.string(),
  occurredAt: z.string(),
  actorUserId: z.uuid().nullable(),
  actorRole: z.string().nullable(),
  patientId: z.uuid().nullable(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  action: z.string(),
  outcome: z.string(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  details: z.unknown().nullable(),
  hash: z.string(),
  actor: actorSchema,
});
export type AuditEventRow = z.infer<typeof auditEventSchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEventSchema),
  nextCursor: z.string().nullable(),
});

/** Koreksi isian formulir (P07): versi lama → baru, alasan, penulis asli, pengoreksi, nilai yang berubah. */
export const formChangeSchema = z.object({
  formCode: z.string(),
  formTitle: z.string(),
  formVersion: z.number().int(),
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  status: z.enum(FORM_RESPONSE_STATUSES),
  reason: z.string().nullable(),
  originalAuthor: z.string().nullable(),
  originalAt: z.string().nullable(),
  correctedBy: z.string().nullable(),
  correctedAt: z.string(),
  rows: z.array(z.object({ key: z.string(), label: z.string(), before: z.string(), after: z.string() })),
});
export type FormChange = z.infer<typeof formChangeSchema>;

export const auditDetailSchema = auditEventSchema.extend({
  prevHash: z.string().nullable(),
  change: formChangeSchema.nullable().optional(),
});
export type AuditEventDetail = z.infer<typeof auditDetailSchema>;

export const findingSchema = z.object({
  key: z.string(),
  kind: z.string(),
  severity: z.enum(['tinggi', 'sedang']),
  title: z.string(),
  description: z.string(),
  actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  count: z.number(),
  lastAt: z.string(),
  grantId: z.uuid().nullable(),
  review: z
    .object({
      outcome: z.string(),
      note: z.string().nullable(),
      reviewedAt: z.string(),
      reviewerId: z.uuid().nullable(),
      reviewer: personSchema,
    })
    .nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

/** Riwayat tinjauan satu temuan (terbaru dulu; `effective` = keputusan yang berlaku). */
export const reviewHistorySchema = z.object({
  key: z.string(),
  items: z.array(
    z.object({
      seq: z.string(),
      outcome: z.string(),
      note: z.string().nullable(),
      reviewedAt: z.string(),
      reviewer: personSchema,
      reviewerRole: z.string().nullable(),
      effective: z.boolean(),
    }),
  ),
});
export type ReviewHistory = z.infer<typeof reviewHistorySchema>;

export const anomaliesSchema = z.object({
  since: z.string(),
  days: z.number(),
  findings: z.array(findingSchema),
});

export const verifySchema = z.object({
  intact: z.boolean(),
  checked: z.number(),
  firstBrokenSeq: z.string().nullable(),
  verifiedAt: z.string(),
});

export const grantSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  patientId: z.uuid(),
  reason: z.string(),
  grantedAt: z.string(),
  expiresAt: z.string(),
  reviewOutcome: z.string().nullable(),
  reviewNote: z.string().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.string().nullable(),
  user: z.object({ id: z.uuid(), displayName: z.string(), username: z.string() }),
  reviewer: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
});
export type Grant = z.infer<typeof grantSchema>;
export const grantListSchema = z.array(grantSchema);
