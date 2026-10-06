'use server';

import { formatJam, formatTanggal } from '@simrs/shared';
import { z } from 'zod';
import { CHEMO_PLAN, CHEMO_VERIFIERS, PRE_CHEMO_LABS } from '@/lib/demo/fixtures/onkologi';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { addDays, labFailures, lockChemoOrder, verifierBlock } from '@/lib/onkologi';
import { cycleStage } from '@/lib/onkologi-toko';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * B11 · Server Action siklus kemoterapi (mode presentasi, ADR-0023/0085): order dikunci DPJP (dosis dihitung server
 * dari LPT Mosteller; penyesuaian < 100% beralasan), gerbang lab pra-kemo (tunda atau override beralasan oleh dokter),
 * verifikasi ganda oleh dua verifikator berbeda dan bukan penulis order. Tersimpan di toko `onkologi`; verifikasi
 * kedua mengalir ke antrean peracikan farmasi (kejadian `siklus.diverifikasi` n = 2).
 */

const revSchema = z.int().min(0);
const DOCTOR_ONLY = 'Order dan gerbang kemoterapi diputuskan dokter (posisi dokter).';
const plan = CHEMO_PLAN;

async function cycleState() {
  const { state } = await readDomain('onkologi');
  return state.cycles[plan.cycle];
}

export async function lockChemoOrderAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('onkologi');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail(DOCTOR_ONLY);
  const p = z
    .strictObject({ heightCm: z.number(), weightKg: z.number(), pct: z.int(), reason: z.string().max(500) })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Order kemoterapi tidak valid.');
  if (![100, 80, 75].includes(p.data.pct)) return rekamFail('Persentase dosis tidak dikenal.');
  const res = lockChemoOrder(p.data, plan.drugs);
  if ('block' in res) return rekamFail(res.block);
  const at = wib(demoNow());
  const c = await commitEvent(
    'onkologi',
    { type: 'siklus.order', cycle: plan.cycle, ...res.lock, reason: p.data.reason.trim(), at },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Siklus ${plan.cycle}: order ditulis ${plan.writer} (LPT ${res.lock.bsa.toLocaleString('id-ID')} m², dosis ${p.data.pct}%) · ${formatJam(at)}.`,
  });
}

export async function chemoGateAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('onkologi');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail(DOCTOR_ONLY);
  const p = z
    .strictObject({ decision: z.enum(['lolos', 'tunda', 'override']), reason: z.string().max(500) })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Keputusan gerbang tidak valid.');
  if (cycleStage(await cycleState()) !== 1) return rekamFail('Siklus tidak sedang di gerbang laboratorium.');
  const failures = labFailures(PRE_CHEMO_LABS);
  if (failures.length === 0 && p.data.decision !== 'lolos') return rekamFail('Hasil lab memenuhi ambang.');
  if (failures.length > 0 && p.data.decision === 'lolos') {
    return rekamFail(
      `${failures.map((f) => f.label).join(', ')} di bawah ambang: tunda atau override beralasan.`,
    );
  }
  if (p.data.decision === 'override' && p.data.reason.trim().length < 10) {
    return rekamFail('Override gerbang lab wajib alasan klinis (minimal 10 karakter).');
  }
  const due = addDays(plan.lastCycleDate, plan.intervalDays);
  const deferredTo = p.data.decision === 'tunda' ? addDays(due, 7) : null;
  const at = wib(demoNow());
  const c = await commitEvent(
    'onkologi',
    {
      type: 'siklus.gerbang',
      cycle: plan.cycle,
      decision: p.data.decision,
      reason: p.data.decision === 'override' ? p.data.reason.trim() : null,
      deferredTo,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message:
      p.data.decision === 'tunda' && deferredTo
        ? `Siklus ${plan.cycle} ditunda ke ${formatTanggal(deferredTo)}; cek ulang darah lengkap dijadwalkan.`
        : p.data.decision === 'override'
          ? `Siklus ${plan.cycle}: gerbang lab di-override: ${p.data.reason.trim()} · ${formatJam(at)}.`
          : `Siklus ${plan.cycle}: laboratorium memenuhi ambang · ${formatJam(at)}.`,
  });
}

export async function verifyChemoAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('onkologi');
  if (!s) return REKAM_DENIED;
  const p = z
    .strictObject({ n: z.union([z.literal(1), z.literal(2)]), verifier: z.string().max(80) })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Verifikasi tidak valid.');
  if (!(CHEMO_VERIFIERS as readonly string[]).includes(p.data.verifier)) {
    return rekamFail('Pilih verifikator dari daftar.');
  }
  const cyc = await cycleState();
  if (cycleStage(cyc) !== p.data.n + 1 || !cyc?.lock)
    return rekamFail(`Verifikasi ${p.data.n} belum gilirannya.`);
  const first = cyc.verify.find((v) => v.n === 1)?.verifier ?? null;
  const blocked = verifierBlock(
    plan.writer,
    p.data.n === 1 ? p.data.verifier : first,
    p.data.n === 2 ? p.data.verifier : null,
    p.data.n,
  );
  if (blocked) return rekamFail(blocked);
  const at = wib(demoNow());
  const c = await commitEvent(
    'onkologi',
    {
      type: 'siklus.diverifikasi',
      cycle: plan.cycle,
      n: p.data.n,
      verifier: p.data.verifier,
      doses: { ...cyc.lock.doses },
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message:
      p.data.n === 1
        ? `Siklus ${plan.cycle}: verifikasi 1 oleh ${p.data.verifier}: dosis cocok · ${formatJam(at)}.`
        : `Siklus ${plan.cycle}: verifikasi 2 oleh ${p.data.verifier}: dosis cocok; siap diracik di BSC farmasi · ${formatJam(at)}.`,
  });
}
