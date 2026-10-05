import 'server-only';
import { PERMISSION_SCOPES } from '@simrs/shared';
import { z } from 'zod';
import { api } from './api';

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
  /** Sudah punya kata sandi; belum = tidak bisa masuk sampai admin mereset sandinya (mis. staf seed). */
  activated: z.boolean(),
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
  /** "Percayai perangkat ini" yang masih berlaku (ADR-0022). */
  trustedDevices: z.array(
    z.object({
      id: z.uuid(),
      userAgent: z.string().nullable(),
      createdAt: z.string(),
      lastUsedAt: z.string().nullable(),
      expiresAt: z.string(),
    }),
  ),
  /** PIN masuk cepat yang masih berlaku (ADR-0024). */
  pinDevices: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      roleName: z.string(),
      unitName: z.string().nullable(),
      createdAt: z.string(),
      lastUsedAt: z.string().nullable(),
      expiresAt: z.string(),
    }),
  ),
});
export type UserDetail = z.infer<typeof userDetailSchema>;

export const summarySchema = z.object({
  total: z.number(),
  active: z.number(),
  locked: z.number(),
  mfaMissing: z.number(),
  dormant: z.number(),
  /** Akun aktif tanpa kata sandi (belum diaktifkan). */
  notActivated: z.number(),
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

/** Batas halaman API unit (`listQuerySchema.limit`) dan pengaman jumlah halaman (≤ 10.000 unit). */
const UNIT_PAGE = 200;
const MAX_UNIT_PAGES = 50;

/**
 * SEMUA unit aktif RS untuk pilihan di formulir (undang pengguna, perangkat anjungan/TV), urut nama. Mengikuti kursor
 * API sampai habis: RS dengan lebih dari satu halaman unit tidak boleh kehilangan pilihan (unit terbaru ada di halaman
 * terakhir karena urutan API = id UUID v7).
 */
export async function listActiveUnits(): Promise<Array<{ value: string; label: string }>> {
  const items: Array<{ id: string; name: string; active: boolean }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_UNIT_PAGES; page++) {
    const qs = new URLSearchParams({ limit: String(UNIT_PAGE) });
    if (cursor) qs.set('cursor', cursor);
    const res: z.infer<typeof unitsSchema> = await api(`/api/v1/facility/units?${qs.toString()}`, {
      schema: unitsSchema,
    });
    items.push(...res.items);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return items
    .filter((u) => u.active)
    .map((u) => ({ value: u.id, label: u.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
}

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
