'use server';

import { CONSENT_EDUCATION_FORM, formAnswersSchema } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K11 · Simpan edukasi terintegrasi (formulir P07 `edukasi_terintegrasi`) untuk satu kunjungan, mode api. API
 * menegakkan izin `forms.response.write` + hak tulis per profesi formulir + ABAC pasien, memvalidasi isian terhadap
 * versi formulir, dan mencatat audit. Klien memanggil `router.refresh()` setelah berhasil.
 */

export type EducationActionResult = { ok: true; message: string } | { ok: false; message: string };

const input = z.strictObject({
  patientId: z.uuid(),
  encounterId: z.uuid(),
  answers: formAnswersSchema,
});

export async function saveEducationAction(raw: unknown): Promise<EducationActionResult> {
  if (webEnv().dataSource !== 'api') return { ok: false, message: 'Aksi ini hanya tersedia di mode api.' };
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  if (!can(s, 'forms.response', 'write')) {
    return { ok: false, message: 'Peran Anda tidak berizin mencatat edukasi pasien.' };
  }
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Isian edukasi tidak lengkap.' };
  const { patientId, encounterId, answers } = parsed.data;
  try {
    await api(`/api/v1/patients/${patientId}/forms/${CONSENT_EDUCATION_FORM}/responses`, {
      method: 'POST',
      body: { answers, encounterId },
      schema: z.object({ id: z.uuid() }),
    });
    return { ok: true, message: 'Edukasi tercatat; catatan final tidak bisa diubah (koreksi berversi).' };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) redirect('/masuk');
      return { ok: false, message: err.message };
    }
    return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
  }
}
