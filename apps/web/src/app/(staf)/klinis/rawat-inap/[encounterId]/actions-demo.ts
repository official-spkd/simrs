'use server';

import {
  CONSCIOUSNESS,
  cpptNoteInputSchema,
  emarAdministrationInputSchema,
  emarWristbandScanInputSchema,
  ewsScore,
  formatJam,
} from '@simrs/shared';
import { z } from 'zod';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import {
  canAdministerMeds,
  canWriteCppt,
  emarGivenFacts,
  emarKey,
  emarRecordBlocker,
  emarTurnBlocker,
  wristbandBlocker,
} from '@/lib/rawat-inap';
import { askepShiftOf, emarGiven } from '@/lib/rme-toko';
import { getInpatient, inpatientScenarioStep } from '@/lib/server/data/klinis/ranap';
import {
  commitCpptNote,
  commitCpptSign,
  type CpptActionResult,
  readRekam,
  REKAM_DATE,
  rekamFail,
  type RekamActionResult,
  SCENARIO_RECORD,
} from '@/lib/server/data/klinis/rekam';
import { demoActionSession, encounterClock } from '@/lib/server/data/klinis/shared';
import { commitEvent } from '@/lib/server/demo/state';
import type { SessionView } from '@/lib/session-view';

/**
 * K04/K07/K12 · Server Action rawat inap (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + posisi + kontrak
 * zod, lalu aturan dibaca dari rekam rawat inap server (fixture + toko demo `rekam-medis`, ADR-0085), bukan klaim
 * klien. CPPT, co-sign, pemberian obat, observasi, dan intervensi askep tersimpan atas nama pengguna sesi, sehingga
 * bertahan setelah muat ulang dan tampil di bagan RME (CPPT, Asuhan keperawatan, Worklist, Kelengkapan). Pasien
 * skenario Simulasi mengikuti tugas skenario. Cap waktu = jam kunjungan.
 */

const UNKNOWN = 'Kunjungan rawat inap tidak dikenal.';
const revSchema = z.int().min(0);

async function admitted(s: SessionView, encounterId: string) {
  const found = await getInpatient(s, encounterId);
  return found?.kind === 'dirawat' ? found.detail : null;
}

/**
 * CPPT baru, koreksi (versi baru, hanya penulisnya, dengan alasan), atau addendum PPA lain. Penulis = pengguna sesi;
 * koreksi catatan tersimpan dibandingkan dengan id pengguna, catatan rekam awal dengan nama penulis.
 */
export async function saveCpptAction(input: unknown, rev: unknown): Promise<CpptActionResult> {
  const s = await demoActionSession();
  if (!canWriteCppt(s.role?.code)) {
    return rekamFail('CPPT ditulis PPA (dokter, residen, perawat, bidan, apoteker).');
  }
  const parsed = cpptNoteInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) return rekamFail(parsed.error?.issues[0]?.message ?? 'CPPT tidak valid.');
  const d = await admitted(s, parsed.data.encounterId);
  if (!d) return rekamFail(UNKNOWN);
  if (d.summary.scenario) return rekamFail(SCENARIO_RECORD);
  return commitCpptNote(s, d.cppt, parsed.data, r.data);
}

const cosignSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  entryId: z.string().min(1).max(80),
});

/**
 * Co-sign DPJP atas catatan residen: hanya posisi dokter yang membawakan DPJP pasien ini, atas entri residen versi
 * terbaru yang menunggu co-sign, bukan catatan sendiri. Tercatat atas nama pengguna sesi.
 */
export async function cosignCpptAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await demoActionSession();
  const parsed = cosignSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) return rekamFail('Permintaan co-sign tidak valid.');
  const d = await admitted(s, parsed.data.encounterId);
  if (!d) return rekamFail(UNKNOWN);
  if (d.summary.scenario) return rekamFail(SCENARIO_RECORD);
  return commitCpptSign(
    s,
    { encounterId: d.summary.encounterId, entries: d.cppt, dpjp: d.summary.dpjp },
    parsed.data.entryId,
    'cosign',
    r.data,
  );
}

const MED_ROLES = 'Pemberian obat dicatat perawat, bidan, atau dokter.';

/**
 * Rekam eMAR dan RM pasien dibaca server, plus giliran tugas `emar` bila pasiennya pasien skenario (dosis jadwal
 * pertama dicatat pada langkah rawat inap / pasca operasi). Null = kunjungan tidak dikenal.
 */
async function emarRecord(s: SessionView, encounterId: string) {
  const d = await admitted(s, encounterId);
  if (!d) return null;
  const p = patientById(d.summary.patientId);
  if (!p) return null;
  const step = await inpatientScenarioStep(s, p.scenario);
  return {
    detail: d,
    meds: d.medications,
    rm: p.rm,
    scenario: d.summary.scenario,
    turn: step ? emarTurnBlocker(step.tasks.emar) : null,
  };
}

/**
 * Pindai gelang sebelum pemberian obat: kode dicocokkan dengan RM pasien kunjungan (atau override verifikasi manual
 * beralasan). Membuka grid eMAR di layar; setiap dosis tetap diperiksa ulang saat dicatat.
 */
export async function scanWristbandAction(
  input: unknown,
): Promise<{ ok?: { at: string; override: boolean }; error?: string }> {
  const s = await demoActionSession();
  if (!canAdministerMeds(s.role?.code)) return { error: MED_ROLES };
  const parsed = emarWristbandScanInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pindai gelang tidak valid.' };
  const v = parsed.data;
  const rec = await emarRecord(s, v.encounterId);
  if (!rec) return { error: UNKNOWN };
  const blocked = rec.turn ?? wristbandBlocker(v.wristbandCode, rec.rm);
  if (blocked) return { error: blocked };
  const at = await encounterClock(s, v.encounterId);
  return { ok: { at: formatJam(at), override: v.wristbandCode === null } };
}

export interface DoseActionResult extends RekamActionResult {
  ok: boolean;
  at?: string;
  late?: boolean;
  doubleCheckedBy?: string | null;
  /** Pasien skenario: dosis dicatat ke Simulasi lewat tugas `emar` (tidak ke toko). */
  scenario?: boolean;
}

/**
 * Catat pemberian SATU dosis eMAR (satu obat, satu slot). Obat, slot, status terlambat, dan sifat kewaspadaan tinggi
 * dibaca dari eMAR pasien di server; gelang dicocokkan dengan RM pasien (atau override beralasan) dan label obat
 * dengan obat slot; cek ganda oleh orang lain. Pasien fixture: tersimpan di toko (tampil juga di Asuhan keperawatan
 * dan tagihan rawat inap); pasien skenario: hanya diperiksa, tugas `emar` Simulasi yang mencatatnya.
 */
export async function recordAdministrationAction(input: unknown, rev: unknown): Promise<DoseActionResult> {
  const s = await demoActionSession();
  if (!canAdministerMeds(s.role?.code)) return rekamFail(MED_ROLES);
  const parsed = emarAdministrationInputSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success)
    return rekamFail(parsed.error?.issues[0]?.message ?? 'Pemberian obat tidak valid.');
  const v = parsed.data;
  const rec = await emarRecord(s, v.encounterId);
  if (!rec) return rekamFail(UNKNOWN);
  const blocked =
    rec.turn ?? emarRecordBlocker({ meds: rec.meds, rm: rec.rm, nurse: s.user.displayName, input: v });
  if (blocked) return rekamFail(blocked);
  const med = rec.meds.find((m) => m.id === v.medicationId);
  if (!med) return rekamFail(UNKNOWN);
  const clock = await encounterClock(s, v.encounterId);
  const at = formatJam(clock);
  const facts = emarGivenFacts(med, v.time, v.doubleCheckedBy);
  if (rec.scenario) return { ok: true, message: 'Dosis diperiksa.', at, ...facts, scenario: true };
  const { state } = await readRekam();
  if (emarGiven(state, v.encounterId)[emarKey(med.id, v.time)]) {
    return rekamFail(`${med.name} jam ${v.time} sudah tercatat diberikan.`);
  }
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'emar.diberikan',
      encounterId: v.encounterId,
      medicationId: med.id,
      time: v.time,
      at,
      givenAt: wib(clock),
      name: med.name,
      late: facts.late,
      lateReason: facts.late ? v.lateReason : null,
      doubleCheckedBy: facts.doubleCheckedBy,
      override: v.wristbandCode === null,
      overrideReason: v.wristbandCode === null ? v.scanOverrideReason : null,
      kfa: med.kfa,
      via: 'ranap',
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, message: c.error, stale: c.stale };
  return { ok: true, message: `${med.name} tercatat diberikan ${at}.`, at, ...facts };
}

const askepSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  interventionId: z.string().min(1).max(100),
});

const NURSE_ROLES = 'Intervensi keperawatan dicatat perawat atau bidan.';

/** Intervensi keperawatan shift berjalan dikerjakan (tercatat atas nama pengguna sesi; tidak bisa dibatalkan). */
export async function recordInterventionAction(input: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await demoActionSession();
  if (s.role?.code !== 'perawat' && s.role?.code !== 'bidan') return rekamFail(NURSE_ROLES);
  const parsed = askepSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) return rekamFail('Intervensi tidak valid.');
  const d = await admitted(s, parsed.data.encounterId);
  if (!d) return rekamFail(UNKNOWN);
  if (d.summary.scenario) return rekamFail(SCENARIO_RECORD);
  const i = d.nursing.findIndex((n) => n.interventions.some((x) => x.id === parsed.data.interventionId));
  const item = d.nursing[i]?.interventions.find((x) => x.id === parsed.data.interventionId);
  if (i < 0 || !item) return rekamFail('Intervensi tidak ada di rencana asuhan pasien ini.');
  if (item.done) return rekamFail('Intervensi ini sudah tercatat pada shift ini.');
  const shift = askepShiftOf(d.emarNow);
  const dxId = `${d.summary.encounterId}-askep-${i + 1}`;
  const at = wib(await encounterClock(s, d.summary.encounterId));
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'askep.intervensi',
      encounterId: d.summary.encounterId,
      dxId,
      interventionId: item.id,
      shift,
      date: REKAM_DATE,
      at,
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, message: c.error, stale: c.stale };
  return { ok: true, message: `${item.label} tercatat ${formatJam(at)} · ${s.user.displayName}` };
}

const obsSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  temp: z.coerce.number().min(30, 'Suhu 30–45 °C.').max(45, 'Suhu 30–45 °C.'),
  hr: z.coerce.number().int('Nadi bilangan bulat.').min(20, 'Nadi 20–250 x/mnt.').max(250, 'Nadi 20–250 x/mnt.'),
  rr: z.coerce.number().int('Napas bilangan bulat.').min(4, 'Napas 4–60 x/mnt.').max(60, 'Napas 4–60 x/mnt.'),
  sbp: z.coerce.number().int().min(40, 'Sistolik 40–260 mmHg.').max(260, 'Sistolik 40–260 mmHg.'),
  dbp: z.coerce.number().int().min(20, 'Diastolik 20–160 mmHg.').max(160, 'Diastolik 20–160 mmHg.'),
  spo2: z.coerce.number().int().min(50, 'SpO2 50–100%.').max(100, 'SpO2 50–100%.'),
  onOxygen: z.boolean(),
  consciousness: z.enum(CONSCIOUSNESS),
});

/** Observasi tanda vital baru: skor EWS dihitung server (mesin NEWS2 bersama), tersimpan atas nama pengguna sesi. */
export async function recordObservationAction(
  input: unknown,
  rev: unknown,
): Promise<RekamActionResult & { score?: number; at?: string }> {
  const s = await demoActionSession();
  if (!canAdministerMeds(s.role?.code)) return rekamFail('Observasi dicatat perawat, bidan, atau dokter.');
  const parsed = obsSchema.safeParse(input);
  const r = revSchema.safeParse(rev);
  if (!parsed.success || !r.success) {
    const issue = parsed.error?.issues[0];
    return rekamFail(issue?.message ?? 'Observasi tidak valid.', String(issue?.path[0] ?? ''));
  }
  const v = parsed.data;
  if (v.dbp >= v.sbp) return rekamFail('Diastolik harus lebih rendah dari sistolik.', 'dbp');
  const d = await admitted(s, v.encounterId);
  if (!d) return rekamFail(UNKNOWN);
  if (d.summary.scenario) return rekamFail(SCENARIO_RECORD);
  const temp = Math.round(v.temp * 10) / 10;
  const score = ewsScore({ ...v, temp });
  const at = wib(await encounterClock(s, v.encounterId));
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'observasi.dicatat',
      encounterId: v.encounterId,
      at,
      temp,
      hr: v.hr,
      rr: v.rr,
      sbp: v.sbp,
      dbp: v.dbp,
      spo2: v.spo2,
      onOxygen: v.onOxygen,
      consciousness: v.consciousness,
      score,
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, message: c.error, stale: c.stale };
  return { ok: true, message: `Observasi ${formatJam(at)} tersimpan · EWS ${score}`, score, at };
}
