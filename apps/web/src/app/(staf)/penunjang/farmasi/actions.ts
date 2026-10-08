'use server';

import {
  cdsDecisionInputSchema,
  pharmacistInterventionInputSchema,
  type PharmacyPrescriptionView,
  pharmacyPrescriptionViewSchema,
  prescriptionAcceptInputSchema,
  prescriptionReviewInputSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * S04 · Server Action layar Farmasi mode api (potongan 4.5): BFF tipis ke `/api/v1/pharmacy/*`. Sesi + izin
 * `pharmacy.review.write` diperiksa di sini agar pesannya jelas; API menegakkan ulang izin, lingkup depo unit, gerbang
 * `CDS_UNRESOLVED`, dan alasan override. Jalur presentasi di `actions-demo.ts`.
 */

type Fail = { ok: false; message: string };
type Done = { ok: true; prescription: PharmacyPrescriptionView } | Fail;

async function authorize(): Promise<Fail | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'pharmacy.review', 'write')
    ? null
    : { ok: false, message: 'Peran Anda tidak berizin menelaah resep.' };
}

function failure(err: unknown): Fail {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

async function post(url: string, body: unknown): Promise<Done> {
  try {
    const prescription = await api(url, { method: 'POST', body, schema: pharmacyPrescriptionViewSchema });
    revalidatePath('/penunjang/farmasi');
    return { ok: true, prescription };
  } catch (err) {
    return failure(err);
  }
}

const id = z.uuid();

/** Terima kiriman CPOE ke depo: nomor R, status telaah, CDS awal. */
export async function acceptPrescriptionAction(input: unknown): Promise<Done> {
  const denied = await authorize();
  if (denied) return denied;
  const p = prescriptionAcceptInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Kiriman tidak dikenali. Muat ulang halaman.' };
  return post('/api/v1/pharmacy/prescriptions', p.data);
}

/** CDS ulang dengan konteks pasien terkini (mis. setelah dokter mengubah order). */
export async function evaluateCdsAction(prescriptionId: unknown): Promise<Done> {
  const denied = await authorize();
  if (denied) return denied;
  const p = id.safeParse(prescriptionId);
  if (!p.success) return { ok: false, message: 'Resep tidak dikenali.' };
  return post(`/api/v1/pharmacy/prescriptions/${p.data}/cds/evaluate`, {});
}

const decisionInput = z.strictObject({ prescriptionId: id, alertId: id, decision: z.unknown() });

/** Tindak lanjut satu temuan CDS: konfirmasi, usul ke dokter, atau override beralasan. */
export async function cdsDecisionAction(input: unknown): Promise<Done> {
  const denied = await authorize();
  if (denied) return denied;
  const p = decisionInput.safeParse(input);
  const d = cdsDecisionInputSchema.safeParse(p.success ? p.data.decision : null);
  if (!p.success || !d.success) {
    return { ok: false, message: 'Override wajib alasan klinis minimal 10 karakter.' };
  }
  return post(
    `/api/v1/pharmacy/prescriptions/${p.data.prescriptionId}/alerts/${p.data.alertId}/decision`,
    d.data,
  );
}

/** Usulan apoteker ke dokter penulis (resep tidak diubah apoteker). */
export async function interventionAction(prescriptionId: unknown, input: unknown): Promise<Done> {
  const denied = await authorize();
  if (denied) return denied;
  const rx = id.safeParse(prescriptionId);
  const p = pharmacistInterventionInputSchema.safeParse(input);
  if (!rx.success || !p.success) {
    return { ok: false, message: 'Pilih item dan tulis usulan minimal 10 karakter.' };
  }
  return post(`/api/v1/pharmacy/prescriptions/${rx.data}/interventions`, p.data);
}

/** Telaah tiga aspek: setujui (diblokir CDS terbuka), sebagian, atau tahan beralasan. */
export async function reviewAction(prescriptionId: unknown, input: unknown): Promise<Done> {
  const denied = await authorize();
  if (denied) return denied;
  const rx = id.safeParse(prescriptionId);
  const p = prescriptionReviewInputSchema.safeParse(input);
  if (!rx.success || !p.success) {
    return {
      ok: false,
      message: p.success ? 'Resep tidak dikenali.' : (p.error.issues[0]?.message ?? 'Telaah belum lengkap.'),
    };
  }
  return post(`/api/v1/pharmacy/prescriptions/${rx.data}/reviews`, p.data);
}
