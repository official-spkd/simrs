import { PERMISSION_SCOPES, TENANT_KINDS } from '@simrs/shared';
import { z } from 'zod';

/** Bentuk respons API yang dipakai web. Respons di luar bentuk ini ditolak (gagal tertutup), tidak diteruskan. */

const UUID_PART = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Token buram API: `<jenis>.<tenantId>.<id>.<rahasia 256 bit>` (ADR-0011). */
export const TOKEN_PATTERN = (kind: 'sa1' | 'sr1' | 'sc1' | 'st1') =>
  new RegExp(`^${kind}\\.${UUID_PART}\\.${UUID_PART}\\.[A-Za-z0-9_-]{43}$`);

export const sessionTokensSchema = z.object({
  accessToken: z.string().regex(TOKEN_PATTERN('sa1')),
  accessExpiresAt: z.iso.datetime(),
  refreshToken: z.string().regex(TOKEN_PATTERN('sr1')),
  refreshExpiresAt: z.iso.datetime(),
});

export const loginResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('mfa_required'),
    challengeToken: z.string().regex(TOKEN_PATTERN('sc1')),
    challengeExpiresAt: z.iso.datetime(),
  }),
  sessionTokensSchema.extend({
    status: z.literal('mfa_enrollment_required'),
    mustChangePassword: z.boolean(),
  }),
  // Perangkat tepercaya yang masih berlaku: langkah MFA dilewati.
  sessionTokensSchema.extend({
    status: z.literal('authenticated'),
    mustChangePassword: z.boolean(),
  }),
]);

export const mfaVerifyResultSchema = sessionTokensSchema.extend({
  mustChangePassword: z.boolean(),
  trustedDevice: z
    .object({ token: z.string().regex(TOKEN_PATTERN('st1')), expiresAt: z.iso.datetime() })
    .nullable(),
});

export const backupCodeResultSchema = z.object({
  channel: z.enum(['whatsapp', 'email']),
  sentTo: z.string(),
  sentAt: z.iso.datetime(),
});

export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    username: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.string().nullable(),
  }),
  tenant: z.object({ id: z.uuid(), code: z.string(), name: z.string(), kind: z.enum(TENANT_KINDS) }),
  mfa: z.object({ enrolled: z.boolean(), sessionVerified: z.boolean() }),
  role: z.object({ code: z.string(), name: z.string() }).nullable(),
  unit: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  permissions: z.array(
    z.object({ resource: z.string(), action: z.string(), scope: z.enum(PERMISSION_SCOPES) }),
  ),
});
export type MeResponse = z.infer<typeof meSchema>;

export const assignmentsSchema = z.array(
  z.object({
    id: z.uuid(),
    roleCode: z.string(),
    roleName: z.string(),
    unitId: z.uuid().nullable(),
    unitName: z.string().nullable(),
    validUntil: z.string().nullable(),
    selected: z.boolean(),
  }),
);
export type AssignmentOption = z.infer<typeof assignmentsSchema>[number];

export const enrollStartSchema = z.object({
  secret: z.string().regex(/^[A-Z2-7]{16,64}$/),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});

export const okSchema = z.object({}).passthrough();
