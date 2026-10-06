'use server';

import { formatJam, SAFETY_REASON_MIN } from '@simrs/shared';
import { z } from 'zod';
import { NURSING_DX_MASTER, nursingPlan } from '@/lib/demo/fixtures/rme-askep';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { emarKey, signerNameMatches, wristbandMatches } from '@/lib/rawat-inap';
import { dueDoses, evalBlocker, shiftOf } from '@/lib/rme-askep';
import { askepKey, emarGiven } from '@/lib/rme-toko';
import {
  committed,
  klinisSession,
  readRekam,
  REKAM_DATE,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';
import type { SessionView } from '@/lib/session-view';

/**
 * K12 · Server Action asuhan keperawatan (mode presentasi, ADR-0023/0085): intervensi per shift, evaluasi SOAP,
 * diagnosis keperawatan baru, dan ronde obat dengan gerbang gelang eMAR. Rencana asuhan dan eMAR dibaca server
 * (fixture + toko `rekam-medis`); pemberian obat tersimpan sebagai dosis eMAR yang sama dengan layar Rawat inap.
 */

const revSchema = z.int().min(0);
const NURSE = 'Asuhan keperawatan dicatat perawat atau bidan.';
const UNKNOWN = 'Pasien rawat inap tidak dikenal.';

async function nurse(): Promise<SessionView | RekamActionResult> {
  const s = await klinisSession('askep');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'perawat' && s.role?.code !== 'bidan') return rekamFail(NURSE);
  return s;
}

async function plan(encounterId: string) {
  const view = await rmeChartById(encounterId);
  const d = view?.chart.inpatient;
  if (!view || !d || d.summary.scenario) return null;
  const extra = view.state.askepDx.filter((x) => x.encounterId === encounterId);
  return { view, d, dxs: [...nursingPlan(d).dxs, ...extra] };
}

const isSession = (x: SessionView | RekamActionResult): x is SessionView => 'user' in x;

const interventionInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  dxId: z.string().min(1).max(100),
  interventionId: z.string().min(1).max(100),
});

/** Intervensi dikerjakan pada shift berjalan (hari presentasi), atas nama pengguna sesi. */
export async function markInterventionAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await nurse();
  if (!isSession(s)) return s;
  const p = interventionInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Intervensi tidak valid.');
  const pl = await plan(p.data.encounterId);
  if (!pl) return rekamFail(UNKNOWN);
  const dx = pl.dxs.find((x) => x.id === p.data.dxId);
  const intv = dx?.interventions.find((x) => x.id === p.data.interventionId);
  if (!dx || !intv) return rekamFail('Intervensi tidak ada di rencana asuhan pasien ini.');
  const now = demoNow();
  const shift = shiftOf(now.toISOString());
  const key = askepKey(dx.id, intv.id, shift, REKAM_DATE);
  if (nursingPlan(pl.d).done[key] || pl.view.state.askepDone[key])
    return rekamFail('Intervensi ini sudah tercatat.');
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'askep.intervensi',
      encounterId: p.data.encounterId,
      dxId: dx.id,
      interventionId: intv.id,
      shift,
      date: REKAM_DATE,
      at: wib(now),
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: `${intv.label} tercatat · ${formatJam(now)}` });
}

const evalInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  dxId: z.string().min(1).max(100),
  shift: z.enum(['pagi', 'siang', 'malam']),
  s: z.string().max(500),
  o: z.string().max(500),
  result: z.enum(['teratasi', 'sebagian', 'belum', '']),
  p: z.string().max(500),
});

/** Evaluasi SOAP satu diagnosis keperawatan per shift (sekali per shift, final). */
export async function saveEvalAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await nurse();
  if (!isSession(s)) return s;
  const p = evalInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Evaluasi tidak valid.');
  const blocked = evalBlocker(p.data);
  if (blocked || !p.data.result) return rekamFail(blocked ?? 'Pilih hasil evaluasi (A).');
  const pl = await plan(p.data.encounterId);
  if (!pl) return rekamFail(UNKNOWN);
  const dx = pl.dxs.find((x) => x.id === p.data.dxId);
  if (!dx) return rekamFail('Diagnosis keperawatan tidak ditemukan.');
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'askep.evaluasi',
      encounterId: p.data.encounterId,
      dxId: dx.id,
      shift: p.data.shift,
      date: REKAM_DATE,
      s: p.data.s.trim(),
      o: p.data.o.trim(),
      result: p.data.result,
      p: p.data.p.trim(),
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Evaluasi ${dx.label} shift ${p.data.shift} final · ${formatJam(at)}`,
    at,
  });
}

const dxInput = z.strictObject({ encounterId: z.string().min(1).max(60), label: z.string().min(1).max(80) });

/** Diagnosis keperawatan baru dari master lokal (luaran dan intervensi dari master, bukan dari klien). */
export async function addNursingDxAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await nurse();
  if (!isSession(s)) return s;
  const p = dxInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Diagnosis keperawatan tidak valid.');
  const m = NURSING_DX_MASTER.find((x) => x.label === p.data.label);
  if (!m) return rekamFail('Pilih diagnosis dari master.');
  const pl = await plan(p.data.encounterId);
  if (!pl) return rekamFail(UNKNOWN);
  if (pl.dxs.some((x) => x.label === m.label))
    return rekamFail(`Diagnosis keperawatan ${m.label} sudah ada.`);
  const now = demoNow();
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'askep.diagnosis',
      encounterId: p.data.encounterId,
      label: m.label,
      outcome: m.outcome,
      interventions: [...m.interventions],
      since: REKAM_DATE,
      at: wib(now),
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Diagnosis keperawatan ${m.label} ditambahkan · ${formatJam(now)}`,
  });
}

const doseInput = z.strictObject({
  encounterId: z.string().min(1).max(60),
  medicationId: z.string().min(1).max(80),
  time: z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/),
  /** Kode gelang hasil pindai (dicocokkan server dengan RM pasien). */
  wristbandCode: z.string().trim().min(1).max(40),
  lateReason: z.string().max(500),
  secondNurse: z.string().max(80),
});

/**
 * Ronde obat: catat satu dosis jatuh tempo. Gelang dicocokkan dengan RM pasien (gerbang eMAR), dosis terlambat wajib
 * alasan, obat high-alert wajib cek ganda oleh perawat lain. Tersimpan sebagai dosis eMAR (`emar.diberikan`).
 */
export async function recordRoundDoseAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await nurse();
  if (!isSession(s)) return s;
  const p = doseInput.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Pemberian obat tidak valid.');
  const pl = await plan(p.data.encounterId);
  if (!pl) return rekamFail(UNKNOWN);
  const rm = chartPatient(pl.view.chart).rm;
  if (!wristbandMatches(p.data.wristbandCode, rm)) {
    return rekamFail('Gelang tidak cocok dengan pasien ini; pemberian tetap terkunci.');
  }
  const dose = dueDoses(pl.d.medications).find(
    (x) => x.medicationId === p.data.medicationId && x.time === p.data.time,
  );
  const med = pl.d.medications.find((m) => m.id === p.data.medicationId);
  if (!dose || !med) return rekamFail('Dosis ini tidak jatuh tempo di eMAR pasien.');
  const { state } = await readRekam();
  if (emarGiven(state, p.data.encounterId)[emarKey(med.id, dose.time)]) {
    return rekamFail(`${med.name} jam ${dose.time} sudah tercatat diberikan.`);
  }
  const lateReason = p.data.lateReason.trim();
  if (dose.late && lateReason.length < SAFETY_REASON_MIN) {
    return rekamFail('Dosis terlambat: alasan keterlambatan wajib (minimal 10 karakter).');
  }
  const second = p.data.secondNurse.trim();
  if (dose.highAlert) {
    if (second.length < 3) return rekamFail('Obat high-alert: cek ganda oleh perawat kedua wajib.');
    if (signerNameMatches(second, s.user.displayName)) {
      return rekamFail('Cek ganda harus oleh petugas lain, bukan pemberi obat.');
    }
  }
  const now = demoNow();
  const at = formatJam(now);
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'emar.diberikan',
      encounterId: p.data.encounterId,
      medicationId: med.id,
      time: dose.time,
      at,
      givenAt: wib(now),
      name: med.name,
      late: dose.late,
      lateReason: dose.late ? lateReason : null,
      doubleCheckedBy: dose.highAlert ? second : null,
      override: false,
      overrideReason: null,
      kfa: med.kfa,
      via: 'askep',
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `${med.name} jadwal ${dose.time} tercatat diberikan · ${at}`,
    at,
  });
}
