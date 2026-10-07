'use server';

import { DOCUMENT_KIND_IDS, patientDocumentSchema, voidDocumentSchema } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CLINICAL_UPLOAD_KINDS, uploadProblem } from '@/lib/patient-documents';
import { api, apiUpload } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * P08 · Server Action dokumen pasien di layar klinis (fase 3 · 3.8, ADR-0059): unggah, batal beralasan, minta TTE.
 * Sesi + izin diperiksa di sini untuk pesan yang jelas; API menegakkan izin `documents.write`, ABAC pasien, status
 * dokumen, dan mencatat audit. Hanya mode api (mode presentasi memakai toko demo dokumen).
 */

export interface DocumentActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

const uuid = z.uuid();
const kindSchema = z.enum(CLINICAL_UPLOAD_KINDS);
/** Jalur halaman pemanggil untuk revalidasi: path internal saja. */
const pathSchema = z
  .string()
  .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/)
  .max(200);

async function authorize(): Promise<string | null> {
  if (webEnv().dataSource !== 'api') return 'Aksi dokumen hanya tersedia di mode api.';
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'documents', 'write') ? null : 'Peran Anda tidak berizin mengubah dokumen pasien.';
}

function failure(err: unknown): DocumentActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { error: err.message };
  }
  return { error: 'Terjadi kesalahan. Coba lagi.' };
}

function revalidate(formData: FormData): void {
  const path = pathSchema.safeParse(formData.get('path'));
  if (path.success) revalidatePath(path.data);
}

export async function uploadDocumentAction(
  _prev: DocumentActionResult,
  formData: FormData,
): Promise<DocumentActionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const patientId = uuid.safeParse(formData.get('patientId'));
  const kind = kindSchema.safeParse(formData.get('kind'));
  const title = String(formData.get('title') ?? '').trim();
  const file = formData.get('file');
  if (!patientId.success) return { error: 'Pasien tidak valid.' };
  if (!kind.success || !DOCUMENT_KIND_IDS.includes(kind.data)) return { error: 'Pilih jenis dokumen.' };
  const blob = file instanceof Blob ? file : null;
  const problem = uploadProblem(blob, title);
  if (problem || !blob) return { error: problem ?? 'Pilih berkas.' };
  try {
    await apiUpload(`/api/v1/patients/${patientId.data}/documents`, {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      headers: {
        'x-document-kind': kind.data,
        'x-document-title': title.slice(0, 200),
        'x-document-filename': (file instanceof File ? file.name : title).slice(0, 120),
      },
      schema: patientDocumentSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidate(formData);
  return { ok: true, message: `Dokumen "${title}" tersimpan.` };
}

export async function voidDocumentAction(
  _prev: DocumentActionResult,
  formData: FormData,
): Promise<DocumentActionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const id = uuid.safeParse(formData.get('documentId'));
  const body = voidDocumentSchema.safeParse({ reason: formData.get('reason') });
  if (!id.success) return { error: 'Dokumen tidak valid.' };
  if (!body.success) return { error: body.error.issues[0]?.message ?? 'Alasan tidak valid.' };
  try {
    await api(`/api/v1/documents/${id.data}/void`, {
      method: 'POST',
      body: body.data,
      schema: patientDocumentSchema,
    });
  } catch (err) {
    return failure(err);
  }
  revalidate(formData);
  return { ok: true, message: 'Dokumen dibatalkan; jejaknya tetap tersimpan.' };
}

export async function requestSignatureAction(
  _prev: DocumentActionResult,
  formData: FormData,
): Promise<DocumentActionResult> {
  const denied = await authorize();
  if (denied) return { error: denied };
  const id = uuid.safeParse(formData.get('documentId'));
  if (!id.success) return { error: 'Dokumen tidak valid.' };
  try {
    await api(`/api/v1/documents/${id.data}/signatures`, { method: 'POST', schema: patientDocumentSchema });
  } catch (err) {
    return failure(err);
  }
  revalidate(formData);
  return {
    ok: true,
    message: 'Permintaan TTE terkirim; status diperbarui setelah penyelenggara menandatangani.',
  };
}
