'use server';

import {
  CONSENT_INFORMATION_KEYS,
  CONSENT_SIGNATURE_MAX_BYTES,
  type ConsentDraft,
  consentDraftCancelInputSchema,
  consentDraftCreateInputSchema,
  consentDraftRefuseInputSchema,
  consentDraftSchema,
  type ConsentInformationKey,
  type ConsentRecord,
  consentRecordSchema,
  consentRevokeInputSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K11 · Server Action tablet persetujuan mode api (W5a): BFF tipis ke `/api/v1/consents/*`. Sesi + izin diperiksa di
 * sini agar pesannya jelas; API menegakkan ulang izin, ABAC pasien (dokter berelasi untuk `consent.sign`), urutan
 * tanda tangan → saksi petugas → final, dan draf tutup-sekali (`CONSENT_CLOSED`). Jalur demo di `[id]/actions-demo.ts`.
 */

type Fail = { ok: false; message: string };

async function authorize(action: 'write' | 'sign', message: string): Promise<Fail | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'consent', action) ? null : { ok: false, message };
}

function failure(err: unknown): Fail {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

/** Halaman tablet (daftar kunjungan + draf ini) dimuat ulang setelah perubahan. */
function refresh(draftId?: string) {
  revalidatePath('/tablet/persetujuan');
  if (draftId) revalidatePath(`/tablet/persetujuan/${draftId}`);
}

const WRITE_DENIED = 'Peran Anda tidak berizin menyiapkan persetujuan tindakan.';
const SIGN_DENIED = 'Final dan penolakan persetujuan hanya oleh dokter berelasi dengan pasien (TTE).';

/** Draf baru dari templat P07 (tindakan, pemberi persetujuan, tujuh butir informasi). */
export async function createConsentDraftAction(
  encounterId: unknown,
  input: unknown,
): Promise<{ ok: true; draftId: string } | Fail> {
  const denied = await authorize('write', WRITE_DENIED);
  if (denied) return denied;
  const enc = z.uuid().safeParse(encounterId);
  const p = consentDraftCreateInputSchema.safeParse(input);
  if (!enc.success || !p.success) {
    return { ok: false, message: 'Lengkapi tindakan dan ketujuh butir informasi.' };
  }
  try {
    const draft = await api(`/api/v1/encounters/${enc.data}/consent-drafts`, {
      method: 'POST',
      body: p.data,
      schema: consentDraftSchema,
    });
    refresh(draft.id);
    return { ok: true, draftId: draft.id };
  } catch (err) {
    return failure(err);
  }
}

/** PNG data URL dari bantalan tanda tangan; batas ukuran sama dengan API (512 KB biner). */
const PNG_PREFIX = 'data:image/png;base64,';
const pngDataUrl = z
  .string()
  .startsWith(PNG_PREFIX)
  .max(PNG_PREFIX.length + Math.ceil((CONSENT_SIGNATURE_MAX_BYTES * 4) / 3) + 4);

const signatureInput = z
  .strictObject({
    name: z.string().trim().min(3).max(80),
    relation: z.string().trim().min(1).max(40).nullable(),
    method: z.enum(['goresan', 'nama']),
    image: pngDataUrl.nullable(),
  })
  .refine((v) => (v.method === 'goresan') === (v.image !== null), {
    message: 'Tanda tangan goresan wajib gambar; ketik nama tanpa gambar.',
  });
type SignatureInput = z.infer<typeof signatureInput>;

const signaturesInput = z.strictObject({
  draftId: z.uuid(),
  acknowledged: z.array(
    z.enum(CONSENT_INFORMATION_KEYS as [ConsentInformationKey, ...ConsentInformationKey[]]),
  ),
  signer: signatureInput,
  familyWitness: signatureInput.nullable(),
});

/** Unggah PNG goresan ke draf (dokumen pasien P08) lalu kembalikan bentuk tanda tangan untuk API. */
async function toApiSignature(draftId: string, slot: 'signer' | 'familyWitness', s: SignatureInput) {
  let imageDocumentId: string | null = null;
  if (s.method === 'goresan' && s.image) {
    const bytes = Uint8Array.from(Buffer.from(s.image.slice(PNG_PREFIX.length), 'base64'));
    const uploaded = await api(`/api/v1/consents/drafts/${draftId}/signature-image?slot=${slot}`, {
      method: 'POST',
      binary: bytes.buffer,
      schema: z.strictObject({ imageDocumentId: z.uuid() }),
    });
    imageDocumentId = uploaded.imageDocumentId;
  }
  return { name: s.name, relation: s.relation, method: s.method, imageDocumentId };
}

/**
 * Pasien/wali menyatakan ketujuh butir dipahami lalu menandatangani (+ saksi keluarga opsional). Atestasi saksi petugas
 * sebelumnya dihapus API (saksi menyaksikan penandatanganan yang berlaku).
 */
export async function saveConsentSignaturesAction(
  input: unknown,
): Promise<{ ok: true; draft: ConsentDraft } | Fail> {
  const denied = await authorize('write', WRITE_DENIED);
  if (denied) return denied;
  const p = signaturesInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Tanda tangan belum lengkap.' };
  const { draftId } = p.data;
  try {
    const signer = await toApiSignature(draftId, 'signer', p.data.signer);
    const familyWitness = p.data.familyWitness
      ? await toApiSignature(draftId, 'familyWitness', p.data.familyWitness)
      : null;
    const draft = await api(`/api/v1/consents/drafts/${draftId}/signatures`, {
      method: 'PUT',
      body: { acknowledged: p.data.acknowledged, signer, familyWitness },
      schema: consentDraftSchema,
    });
    refresh(draftId);
    return { ok: true, draft };
  } catch (err) {
    return failure(err);
  }
}

const draftRef = z.strictObject({ draftId: z.uuid() });

/** Atestasi saksi petugas dengan sesi petugas itu sendiri (berlaku 30 menit sampai final). */
export async function attestConsentWitnessAction(
  input: unknown,
): Promise<{ ok: true; draft: ConsentDraft } | Fail> {
  const denied = await authorize('write', WRITE_DENIED);
  if (denied) return denied;
  const p = draftRef.safeParse(input);
  if (!p.success) return { ok: false, message: 'Draf tidak dikenali.' };
  try {
    const draft = await api(`/api/v1/consents/drafts/${p.data.draftId}/witness`, {
      method: 'POST',
      body: {},
      schema: consentDraftSchema,
    });
    refresh(p.data.draftId);
    return { ok: true, draft };
  } catch (err) {
    return failure(err);
  }
}

/** Final oleh dokter berelasi: entri persetujuan + PDF bertanda tangan + TTE dokter. */
export async function finalizeConsentApiAction(
  input: unknown,
): Promise<{ ok: true; consent: ConsentRecord } | Fail> {
  const denied = await authorize('sign', SIGN_DENIED);
  if (denied) return denied;
  const p = draftRef.safeParse(input);
  if (!p.success) return { ok: false, message: 'Draf tidak dikenali.' };
  try {
    const consent = await api(`/api/v1/consents/drafts/${p.data.draftId}/finalize`, {
      method: 'POST',
      body: {},
      schema: consentRecordSchema,
    });
    refresh(p.data.draftId);
    return { ok: true, consent };
  } catch (err) {
    return failure(err);
  }
}

const reasonInput = draftRef.extend({ reason: consentDraftRefuseInputSchema.shape.reason });

/** Penolakan beralasan (≥ 10 karakter) oleh dokter berelasi: entri `tolak` + PDF + TTE. */
export async function refuseConsentApiAction(
  input: unknown,
): Promise<{ ok: true; consent: ConsentRecord } | Fail> {
  const denied = await authorize('sign', SIGN_DENIED);
  if (denied) return denied;
  const p = reasonInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Alasan penolakan wajib diisi (minimal 10 karakter).' };
  try {
    const consent = await api(`/api/v1/consents/drafts/${p.data.draftId}/refuse`, {
      method: 'POST',
      body: { reason: p.data.reason },
      schema: consentRecordSchema,
    });
    refresh(p.data.draftId);
    return { ok: true, consent };
  } catch (err) {
    return failure(err);
  }
}

const cancelInput = draftRef.extend({ reason: consentDraftCancelInputSchema.shape.reason });

/** Draf dibatalkan beralasan (tidak menjadi rekam medis). */
export async function cancelConsentDraftAction(
  input: unknown,
): Promise<{ ok: true; draft: ConsentDraft } | Fail> {
  const denied = await authorize('write', WRITE_DENIED);
  if (denied) return denied;
  const p = cancelInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Alasan pembatalan wajib diisi (minimal 10 karakter).' };
  try {
    const draft = await api(`/api/v1/consents/drafts/${p.data.draftId}/cancel`, {
      method: 'POST',
      body: { reason: p.data.reason },
      schema: consentDraftSchema,
    });
    refresh(p.data.draftId);
    return { ok: true, draft };
  } catch (err) {
    return failure(err);
  }
}

const revokeInput = z.strictObject({
  consentId: z.uuid(),
  reason: consentRevokeInputSchema.shape.reason,
  signerKind: z.enum(['pasien', 'wali']),
  signerName: z.string().trim().min(3).max(80),
  relation: z.string().trim().min(1).max(40).nullable(),
});

/**
 * Pencabutan persetujuan final oleh pasien/wali (tanda tangan ketik nama), dicatat dokter berelasi: entri baru
 * `dicabut` + PDF + TTE (versi ber-TTE tidak bisa digantikan).
 */
export async function revokeConsentAction(
  input: unknown,
): Promise<{ ok: true; consent: ConsentRecord } | Fail> {
  const denied = await authorize('sign', SIGN_DENIED);
  if (denied) return denied;
  const p = revokeInput.safeParse(input);
  if (!p.success) {
    return {
      ok: false,
      message: 'Isi alasan (minimal 10 karakter) dan nama lengkap yang mencabut persetujuan.',
    };
  }
  if (p.data.signerKind === 'wali' && !p.data.relation) {
    return { ok: false, message: 'Hubungan wali dengan pasien wajib diisi.' };
  }
  try {
    const consent = await api(`/api/v1/consents/${p.data.consentId}/revoke`, {
      method: 'POST',
      body: {
        reason: p.data.reason,
        signerKind: p.data.signerKind,
        signer: { name: p.data.signerName, relation: p.data.relation, method: 'nama', imageDocumentId: null },
        familyWitness: null,
      },
      schema: consentRecordSchema,
    });
    refresh();
    return { ok: true, consent };
  } catch (err) {
    return failure(err);
  }
}
