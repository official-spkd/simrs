import 'server-only';
import { PERMISSION_SCOPES } from '@simrs/shared';
import { z } from 'zod';

/** Bentuk respons API layar Akses (P03). Respons di luar bentuk ini ditolak, tidak diteruskan ke UI. */

const assignment = z.object({
  id: z.uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  unitId: z.uuid().nullable(),
  unitName: z.string().nullable(),
  validUntil: z.string().nullable(),
});

const accountFlags = {
  mfaEnrolled: z.boolean(),
  locked: z.boolean(),
  dormant: z.boolean(),
  neverLoggedIn: z.boolean(),
};

export const userRowSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  status: z.string(),
  lastLoginAt: z.string().nullable(),
  mustChangePassword: z.boolean(),
  ...accountFlags,
  assignments: z.array(assignment),
});
export type UserRow = z.infer<typeof userRowSchema>;

export const userPageSchema = z.object({ items: z.array(userRowSchema), nextCursor: z.string().nullable() });

export const userDetailSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  /** Tersamar (`0812•••7890`); nilai utuh tidak pernah dikirim ke web. */
  phone: z.string().nullable(),
  status: z.string(),
  lastLoginAt: z.string().nullable(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  ...accountFlags,
  assignments: z.array(assignment.extend({ validFrom: z.string(), pending: z.boolean() })),
});
export type UserDetail = z.infer<typeof userDetailSchema>;

export const summarySchema = z.object({
  total: z.number(),
  active: z.number(),
  locked: z.number(),
  mfaMissing: z.number(),
  dormant: z.number(),
  breakGlass7d: z.number(),
  breakGlassPending: z.number(),
  dormantDays: z.number(),
});
export type AccessSummary = z.infer<typeof summarySchema>;

export const rolesSchema = z.object({
  catalog: z.array(z.object({ resource: z.string(), label: z.string(), actions: z.array(z.string()) })),
  roles: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      isSystem: z.boolean(),
      active: z.boolean(),
      permissions: z.array(
        z.object({ resource: z.string(), action: z.string(), scope: z.enum(PERMISSION_SCOPES) }),
      ),
    }),
  ),
});
export type RolesData = z.infer<typeof rolesSchema>;

export const unitsSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string(), active: z.boolean() })),
  nextCursor: z.string().nullable(),
});

export const createdUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  temporaryPassword: z.string().min(12),
});

export const resetPasswordSchema = z.object({ id: z.uuid(), temporaryPassword: z.string().min(12) });

export const roleSaveSchema = z.object({
  code: z.string(),
  added: z.array(z.string()),
  removed: z.array(z.string()),
});
