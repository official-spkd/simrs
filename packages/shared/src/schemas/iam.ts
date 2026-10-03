import { z } from 'zod';
import { isPermission, PERMISSION_SCOPES } from '../authz';
import { USERNAME } from './auth';

/** P03 · Skema manajemen pengguna, peran, penugasan, dan akses darurat. */
const ROLE_CODE = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Kode peran tidak valid');

export const assignmentInputSchema = z.strictObject({
  roleCode: ROLE_CODE,
  unitId: z.uuid().optional(),
  validFrom: z.iso.datetime({ offset: true }).optional(),
  validUntil: z.iso.datetime({ offset: true }).optional(),
});

export const createUserSchema = z.strictObject({
  username: USERNAME,
  displayName: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase().optional(),
  assignments: z.array(assignmentInputSchema).max(10).default([]),
});

export const updateUserSchema = z
  .strictObject({
    displayName: z.string().trim().min(2).max(120).optional(),
    email: z.email().trim().toLowerCase().nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Minimal satu field diubah');

export const endAssignmentSchema = z.strictObject({ reason: z.string().trim().min(5).max(300) });

export const rolePermissionsSchema = z.strictObject({
  grants: z
    .array(
      z
        .strictObject({ resource: z.string(), action: z.string(), scope: z.enum(PERMISSION_SCOPES) })
        .refine((g) => isPermission(g.resource, g.action), 'Izin tidak dikenal'),
    )
    .max(200),
});

export const selectAssignmentSchema = z.strictObject({ assignmentId: z.uuid() });

export const breakGlassSchema = z.strictObject({
  patientId: z.uuid(),
  reason: z.string().trim().min(20, 'Tulis alasan klinis minimal 20 karakter').max(500),
});

export const breakGlassReviewSchema = z.strictObject({
  outcome: z.enum(['sah', 'perlu_klarifikasi']),
  note: z.string().trim().max(500).optional(),
});

export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type RolePermissionsInput = z.infer<typeof rolePermissionsSchema>;
export type BreakGlassInput = z.infer<typeof breakGlassSchema>;
export type BreakGlassReviewInput = z.infer<typeof breakGlassReviewSchema>;
