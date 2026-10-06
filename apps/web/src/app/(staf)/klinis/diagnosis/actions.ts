'use server';

import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { RME_ICD10, RME_ICD9 } from '@/lib/demo/fixtures/rme-diagnosis';
import { DEMO_TODAY, demoNow } from '@/lib/demo/fixtures/waktu';
import { applyDiagnosisOp, diagnosisOpSchema } from '@/lib/rme-diagnosis-toko';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { diagnosisView } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K08 · Server Action diagnosis, prosedur, problem list, dan alergi (mode presentasi, ADR-0023/0085). Operasi
 * dijalankan terhadap daftar server (rekam awal + toko `rekam-medis`) dengan aturan murni `lib/rme-diagnosis*.ts`;
 * hasilnya entri versi baru atas nama pengguna sesi (append-only, salah entri beralasan).
 */

const input = z.strictObject({ encounterId: z.string().min(1).max(60), op: diagnosisOpSchema });

export async function diagnosisAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('diagnosis');
  if (!s) return REKAM_DENIED;
  const p = input.safeParse(raw);
  const r = z.int().min(0).safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Perubahan diagnosis tidak valid.');
  const view = await diagnosisView(p.data.encounterId);
  if (!view) return rekamFail('Kunjungan tidak dikenal.');
  const at = wib(demoNow());
  const res = applyDiagnosisOp(view.lists, p.data.op, {
    role: s.role?.code ?? null,
    by: s.user.displayName,
    at,
    today: DEMO_TODAY,
    newId: (prefix) => (n) => `${p.data.encounterId}-${prefix}-r${r.data}-${n}`,
    icd10: RME_ICD10,
    icd9: RME_ICD9,
  });
  if (!res.ok) return rekamFail(res.error);
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'diagnosis.dicatat',
      encounterId: p.data.encounterId,
      dx: res.dx,
      procs: res.procs,
      problems: res.problems,
      allergies: res.allergies,
      nkda: res.nkda,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: res.message });
}
