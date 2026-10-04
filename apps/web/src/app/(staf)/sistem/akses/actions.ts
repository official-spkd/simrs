'use server';

import {
  assignmentInputSchema,
  createUserSchema,
  endAssignmentSchema,
  formatJam,
  rolePermissionsSchema,
  updateUserSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { createdUserSchema, resetPasswordSchema, roleSaveSchema } from '@/lib/server/iam';
import { okSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * Server Action layar Akses. Setiap action = endpoint POST publik: sesi dan izin diperiksa di sini (untuk pesan
 * yang jelas), input divalidasi dengan skema bersama, dan API tetap menjadi penegak akhir (izin, admin terakhir,
 * anti-eskalasi, audit). Kata sandi sementara hanya dikembalikan sekali ke layar admin, tidak disimpan web.
 */

const PATH = '/sistem/akses';
const ROLE_CODE = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/);

export interface ActionResult {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
  message?: string;
}

async function authorize(resource: string, action: string): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : 'Peran Anda tidak berizin untuk aksi ini.';
}

function failure(err: unknown): ActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    if (err.status === 429) return { error: 'Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.' };
    return { error: err.message };
  }
  return { error: 'Terjadi kesalahan. Coba lagi.' };
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');
/** Tanggal dari `<input type="date">` → awal hari WIB. */
const startOfDayWib = (v: string) => (v ? `${v}T00:00:00+07:00` : undefined);

export interface InviteResult extends ActionResult {
  created?: { id: string; username: string; temporaryPassword: string };
  values?: Record<string, string>;
}

export async function inviteUserAction(_prev: InviteResult, formData: FormData): Promise<InviteResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  const values = {
    username: text(formData.get('username')),
    displayName: text(formData.get('displayName')),
    email: text(formData.get('email')),
    phone: text(formData.get('phone')),
    roleCode: text(formData.get('roleCode')),
    unitId: text(formData.get('unitId')),
  };
  const parsed = createUserSchema.safeParse({
    username: values.username,
    displayName: values.displayName,
    email: values.email || undefined,
    phone: values.phone || undefined,
    assignments: values.roleCode ? [{ roleCode: values.roleCode, unitId: values.unitId || undefined }] : [],
  });
  if (!parsed.success) return { fields: fieldErrors(parsed.error), values };
  try {
    const created = await api('/api/v1/iam/users', {
      method: 'POST',
      body: parsed.data,
      schema: createdUserSchema,
    });
    revalidatePath(PATH);
    return { ok: true, created };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { fields: { username: 'NIP/email ini sudah dipakai akun lain di RS ini.' }, values };
    }
    return { ...failure(err), values };
  }
}

export interface ResetPasswordResult extends ActionResult {
  temporaryPassword?: string;
}

export async function resetPasswordAction(userId: string): Promise<ResetPasswordResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  if (!z.uuid().safeParse(userId).success) return { error: 'Pengguna tidak valid.' };
  try {
    const r = await api(`/api/v1/iam/users/${userId}/reset-password`, {
      method: 'POST',
      schema: resetPasswordSchema,
    });
    revalidatePath(PATH);
    return { ok: true, temporaryPassword: r.temporaryPassword };
  } catch (err) {
    return failure(err);
  }
}

export async function resetMfaAction(userId: string): Promise<ActionResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  if (!z.uuid().safeParse(userId).success) return { error: 'Pengguna tidak valid.' };
  try {
    await api(`/api/v1/iam/users/${userId}/reset-mfa`, { method: 'POST', schema: okSchema });
    revalidatePath(PATH);
    return { ok: true, message: `Verifikasi dua langkah direset pukul ${formatJam(new Date())}.` };
  } catch (err) {
    return failure(err);
  }
}

/** Cabut PIN masuk cepat di satu perangkat milik pengguna (perangkat hilang, pindah unit). ADR-0024. */
export async function revokePinDeviceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  const deviceId = text(formData.get('deviceId'));
  if (!z.uuid().safeParse(deviceId).success) return { error: 'Perangkat tidak valid.' };
  try {
    await api(`/api/v1/iam/pin-devices/${deviceId}/revoke`, { method: 'POST', schema: okSchema });
    revalidatePath(PATH);
    return { ok: true, message: `PIN dicabut pukul ${formatJam(new Date())}.` };
  } catch (err) {
    return failure(err);
  }
}

/** Kontak notifikasi akun (email + no. HP/WhatsApp); kosong = dihapus. */
export async function updateContactAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  const userId = text(formData.get('userId'));
  if (!z.uuid().safeParse(userId).success) return { error: 'Pengguna tidak valid.' };
  const email = text(formData.get('email'));
  const phone = text(formData.get('phone'));
  const parsed = updateUserSchema.safeParse({
    email: email || null,
    // No. HP tersimpan hanya ditampilkan tersamar: kolom kosong = tidak diubah, kecuali "hapus no. HP" dicentang.
    ...(phone ? { phone } : formData.get('removePhone') === 'on' ? { phone: null } : {}),
  });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };
  try {
    await api(`/api/v1/iam/users/${userId}`, { method: 'PATCH', body: parsed.data, schema: okSchema });
    revalidatePath(PATH);
    return { ok: true, message: `Kontak disimpan pukul ${formatJam(new Date())}.` };
  } catch (err) {
    return failure(err);
  }
}

export async function setUserStatusAction(
  userId: string,
  status: 'active' | 'disabled',
): Promise<ActionResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  if (!z.uuid().safeParse(userId).success || !['active', 'disabled'].includes(status)) {
    return { error: 'Permintaan tidak valid.' };
  }
  try {
    await api(`/api/v1/iam/users/${userId}`, { method: 'PATCH', body: { status }, schema: okSchema });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `${status === 'disabled' ? 'Akun dinonaktifkan' : 'Akun diaktifkan kembali'} pukul ${formatJam(new Date())}.`,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function addAssignmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  const userId = text(formData.get('userId'));
  if (!z.uuid().safeParse(userId).success) return { error: 'Pengguna tidak valid.' };
  const parsed = assignmentInputSchema.safeParse({
    roleCode: text(formData.get('roleCode')),
    unitId: text(formData.get('unitId')) || undefined,
    validFrom: startOfDayWib(text(formData.get('validFrom'))),
    validUntil: startOfDayWib(text(formData.get('validUntil'))),
  });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };
  try {
    await api(`/api/v1/iam/users/${userId}/assignments`, {
      method: 'POST',
      body: parsed.data,
      schema: okSchema,
    });
    revalidatePath(PATH);
    return { ok: true, message: `Penugasan ditambahkan pukul ${formatJam(new Date())}.` };
  } catch (err) {
    return failure(err);
  }
}

export async function endAssignmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const denied = await authorize('iam.users', 'write');
  if (denied) return { error: denied };
  const assignmentId = text(formData.get('assignmentId'));
  if (!z.uuid().safeParse(assignmentId).success) return { error: 'Penugasan tidak valid.' };
  const parsed = endAssignmentSchema.safeParse({ reason: text(formData.get('reason')) });
  if (!parsed.success)
    return { fields: { reason: 'Tulis alasan minimal 5 karakter (tercatat di jejak audit).' } };
  try {
    await api(`/api/v1/iam/assignments/${assignmentId}/end`, {
      method: 'POST',
      body: parsed.data,
      schema: okSchema,
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export interface RoleSaveResult extends ActionResult {
  changes?: number;
  savedAt?: string;
}

export async function saveRolePermissionsAction(
  code: string,
  grants: Array<{ resource: string; action: string; scope: string }>,
): Promise<RoleSaveResult> {
  const denied = await authorize('iam.roles', 'write');
  if (denied) return { error: denied };
  const role = ROLE_CODE.safeParse(code);
  const body = rolePermissionsSchema.safeParse({ grants });
  if (!role.success || !body.success) return { error: 'Matriks izin tidak valid.' };
  try {
    const r = await api(`/api/v1/iam/roles/${role.data}/permissions`, {
      method: 'PUT',
      body: body.data,
      schema: roleSaveSchema,
    });
    revalidatePath(PATH);
    // Satu sel matriks = satu perubahan (ganti lingkup tercatat di audit sebagai hapus + tambah).
    const cells = new Set([...r.added, ...r.removed].map((x) => x.split(':')[0]));
    return { ok: true, changes: cells.size, savedAt: formatJam(new Date()) };
  } catch (err) {
    return failure(err);
  }
}
