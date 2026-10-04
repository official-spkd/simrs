'use server';

import { FORM_CATEGORIES, type FormCategory, formSchemaSchema } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { definitionSchema } from '@/lib/server/forms';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * Aksi komite rekam medis di pembuat formulir (P07). Sesi dan izin diperiksa di sini (pesan jelas) dan
 * ditegakkan API (izin `forms.definition.*`, siklus draf → diajukan → terbit, token konkurensi
 * `baseUpdatedAt` agar simpanan tidak menimpa perubahan anggota komite lain). Setiap langkah diaudit API.
 */

const BASE = '/sistem/formulir';
const CODE = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{2,40}$/,
    'Kode formulir: 3–41 karakter huruf kecil, angka, garis bawah (mis. skrining_nyeri).',
  );
const ROLES = z
  .array(z.string().regex(/^[a-z][a-z0-9_]{2,40}$/))
  .min(1, 'Pilih minimal satu profesi yang boleh mengisi.')
  .max(20);
const TITLE = z
  .string()
  .trim()
  .min(3, 'Judul formulir minimal 3 karakter.')
  .max(200, 'Judul maksimal 200 karakter.');
const NOTE = z
  .string()
  .trim()
  .min(3, 'Catatan perubahan minimal 3 karakter.')
  .max(300, 'Catatan perubahan maksimal 300 karakter.');

export interface FormActionResult {
  error?: string;
  /** Waktu ubah draf terbaru (token konkurensi berikutnya). */
  updatedAt?: string;
}

async function authorize(action: 'write' | 'publish'): Promise<string | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  if (can(s, 'forms.definition', action)) return null;
  return action === 'publish'
    ? 'Peran Anda tidak berizin menerbitkan formulir.'
    : 'Peran Anda tidak berizin mengubah formulir klinis.';
}

function failure(err: unknown): FormActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { error: err.message };
  }
  return { error: 'Terjadi kesalahan. Coba lagi.' };
}

/** Pesan galat validasi: pesan kustom (Bahasa Indonesia) dipakai apa adanya, selebihnya pesan umum. */
function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Isian tidak valid.';
  const custom = issue.code === 'custom' || issue.code === 'invalid_format' || issue.path[0] !== 'schema';
  return custom && issue.message
    ? issue.message
    : 'Isi formulir tidak valid: periksa panjang teks dan kunci field.';
}

const createInput = z.strictObject({
  code: CODE,
  title: TITLE,
  category: z.enum(
    Object.keys(FORM_CATEGORIES) as [FormCategory, ...FormCategory[]],
    'Pilih kategori formulir.',
  ),
  writeRoles: ROLES,
  changeNote: NOTE,
});

/** Formulir baru = draf v1 dengan satu bagian kosong; komite melengkapinya di pembuat formulir. */
export async function createFormAction(
  _prev: FormActionResult,
  formData: FormData,
): Promise<FormActionResult> {
  const denied = await authorize('write');
  if (denied) return { error: denied };
  const parsed = createInput.safeParse({
    code: formData.get('code'),
    title: formData.get('title'),
    category: formData.get('category'),
    writeRoles: formData.getAll('writeRoles'),
    changeNote: formData.get('changeNote'),
  });
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  try {
    await api('/api/v1/forms', {
      method: 'POST',
      body: { ...parsed.data, schema: { sections: [{ title: 'Bagian 1', fields: [] }] } },
      schema: definitionSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${parsed.data.code}`);
}

const draftInput = z.strictObject({
  code: CODE,
  baseUpdatedAt: z.iso.datetime(),
  title: TITLE,
  writeRoles: ROLES,
  changeNote: NOTE,
  schema: formSchemaSchema,
});
export type DraftInput = z.input<typeof draftInput>;

async function putDraft(d: z.infer<typeof draftInput>): Promise<string> {
  const saved = await api(`/api/v1/forms/${d.code}/draft`, {
    method: 'PUT',
    body: {
      baseUpdatedAt: d.baseUpdatedAt,
      title: d.title,
      writeRoles: d.writeRoles,
      changeNote: d.changeNote,
      schema: d.schema,
    },
    schema: definitionSchema,
  });
  return saved.updatedAt;
}

export async function saveDraftAction(input: DraftInput): Promise<FormActionResult> {
  const denied = await authorize('write');
  if (denied) return { error: denied };
  const parsed = draftInput.safeParse(input);
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  try {
    const updatedAt = await putDraft(parsed.data);
    revalidatePath(`${BASE}/${parsed.data.code}`);
    return { updatedAt };
  } catch (err) {
    return failure(err);
  }
}

/** Simpan (bila ada perubahan) lalu ajukan ke Komite RM atas versi yang baru disimpan. */
export async function submitDraftAction(input: DraftInput & { dirty: boolean }): Promise<FormActionResult> {
  const denied = await authorize('write');
  if (denied) return { error: denied };
  const { dirty, ...rest } = input;
  const parsed = draftInput.safeParse(rest);
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  const d = parsed.data;
  let base = d.baseUpdatedAt;
  try {
    if (dirty === true) base = await putDraft(d);
    const submitted = await api(`/api/v1/forms/${d.code}/submit`, {
      method: 'POST',
      body: { baseUpdatedAt: base },
      schema: definitionSchema,
    });
    revalidatePath(`${BASE}/${d.code}`);
    revalidatePath(BASE);
    return { updatedAt: submitted.updatedAt };
  } catch (err) {
    revalidatePath(`${BASE}/${d.code}`);
    return { ...failure(err), updatedAt: base };
  }
}

const transitionInput = z.strictObject({
  code: CODE,
  baseUpdatedAt: z.iso.datetime(),
  step: z.enum(['withdraw', 'publish']),
});

/** Tarik pengajuan (kembali ke draf) atau terbitkan versi yang diajukan. */
export async function transitionAction(input: z.input<typeof transitionInput>): Promise<FormActionResult> {
  const parsed = transitionInput.safeParse(input);
  if (!parsed.success) return { error: 'Permintaan tidak valid.' };
  const denied = await authorize(parsed.data.step === 'publish' ? 'publish' : 'write');
  if (denied) return { error: denied };
  const { code, baseUpdatedAt, step } = parsed.data;
  try {
    const row = await api(`/api/v1/forms/${code}/${step}`, {
      method: 'POST',
      body: { baseUpdatedAt },
      schema: definitionSchema,
    });
    revalidatePath(`${BASE}/${code}`);
    revalidatePath(BASE);
    return { updatedAt: row.updatedAt };
  } catch (err) {
    revalidatePath(`${BASE}/${code}`);
    return failure(err);
  }
}

const newDraftInput = z.strictObject({ code: CODE, changeNote: NOTE });

/** Draf versi berikutnya, disalin dari versi yang berlaku. */
export async function newDraftAction(input: z.input<typeof newDraftInput>): Promise<FormActionResult> {
  const denied = await authorize('write');
  if (denied) return { error: denied };
  const parsed = newDraftInput.safeParse(input);
  if (!parsed.success) return { error: issueMessage(parsed.error) };
  try {
    const row = await api(`/api/v1/forms/${parsed.data.code}/drafts`, {
      method: 'POST',
      body: { changeNote: parsed.data.changeNote },
      schema: definitionSchema,
    });
    revalidatePath(`${BASE}/${parsed.data.code}`);
    revalidatePath(BASE);
    return { updatedAt: row.updatedAt };
  } catch (err) {
    revalidatePath(`${BASE}/${parsed.data.code}`);
    return failure(err);
  }
}
