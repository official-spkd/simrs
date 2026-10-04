'use server';

import {
  type CpptRole,
  cpptNoteInputSchema,
  emarAdministrationInputSchema,
  emarWristbandScanInputSchema,
  formatJam,
} from '@simrs/shared';
import { z } from 'zod';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import {
  canAdministerMeds,
  canWriteCppt,
  cpptAddendumBlocker,
  cpptCorrectionBlocker,
  cpptRoleOf,
  emarGivenFacts,
  emarRecordBlocker,
  emarTurnBlocker,
  localCpptId,
  wristbandBlocker,
} from '@/lib/rawat-inap';
import {
  demoActionSession,
  encounterClock,
  getInpatient,
  inpatientScenarioStep,
} from '@/lib/server/data/rawat-inap';
import type { SessionView } from '@/lib/session-view';

/**
 * K04/K07 · Server Action rawat inap (mode presentasi, ADR-0023): gerbang demo + sesi lengkap + posisi + kontrak
 * zod, lalu aturan dibaca dari rekam rawat inap server (bukan klaim klien). Tidak menyimpan apa pun; layar menambah
 * entri secara lokal dengan penanda "(simulasi, tidak disimpan)". Cap waktu = jam kunjungan (skenario: jam simulasi).
 */

export interface CpptActionResult {
  ok?: { id: string; at: string; author: string; role: CpptRole };
  error?: string;
}

const UNKNOWN = 'Kunjungan rawat inap tidak dikenal.';

/** CPPT baru, koreksi (versi baru, hanya penulisnya, dengan alasan), atau addendum PPA lain. Penulis = pengguna. */
export async function saveCpptAction(input: unknown): Promise<CpptActionResult> {
  const s = await demoActionSession();
  if (!canWriteCppt(s.role?.code)) {
    return { error: 'CPPT ditulis PPA (dokter, residen, perawat, bidan, apoteker).' };
  }
  const parsed = cpptNoteInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'CPPT tidak valid.' };
  const v = parsed.data;
  const found = await getInpatient(s, v.encounterId);
  if (found?.kind !== 'dirawat') return { error: UNKNOWN };
  const user = { id: s.user.id, name: s.user.displayName };
  const blocked =
    v.supersedesId !== null
      ? cpptCorrectionBlocker(found.detail.cppt, v.supersedesId, user)
      : v.addendumOf !== null
        ? cpptAddendumBlocker(found.detail.cppt, v.addendumOf)
        : null;
  if (blocked) return { error: blocked };
  const at = await encounterClock(s, v.encounterId);
  return {
    ok: {
      id: localCpptId(s.user.id, Date.now()),
      at: wib(at),
      author: s.user.displayName,
      role: cpptRoleOf(s.role?.code),
    },
  };
}

const cosignSchema = z.strictObject({
  encounterId: z.string().min(1).max(60),
  entryId: z.string().min(1).max(60),
});

/** Co-sign DPJP atas catatan residen: hanya posisi dokter (DPJP), atas entri residen yang menunggu co-sign. */
export async function cosignCpptAction(
  input: unknown,
): Promise<{ ok?: { by: string; at: string }; error?: string }> {
  const s = await demoActionSession();
  const parsed = cosignSchema.safeParse(input);
  if (!parsed.success) return { error: 'Permintaan co-sign tidak valid.' };
  if (s.role?.code !== 'dokter') return { error: 'Co-sign hanya oleh DPJP (posisi dokter).' };
  const found = await getInpatient(s, parsed.data.encounterId);
  if (found?.kind !== 'dirawat') return { error: UNKNOWN };
  const entry = found.detail.cppt.find((e) => e.id === parsed.data.entryId);
  // Entri residen yang ditulis di sesi ini belum tersimpan di server: hanya entri rekam medis yang diperiksa.
  if (entry && (!entry.cosignRequired || entry.cosignedBy)) {
    return { error: 'Entri ini tidak menunggu co-sign DPJP.' };
  }
  const at = await encounterClock(s, parsed.data.encounterId);
  return { ok: { by: s.user.displayName, at: wib(at) } };
}

const MED_ROLES = 'Pemberian obat dicatat perawat, bidan, atau dokter.';

/**
 * Rekam eMAR dan RM pasien dibaca server, plus giliran tugas `emar` bila pasiennya pasien skenario (dosis jadwal
 * pertama dicatat pada langkah rawat inap / pasca operasi). Null = kunjungan tidak dikenal.
 */
async function emarRecord(s: SessionView, encounterId: string) {
  const found = await getInpatient(s, encounterId);
  if (found?.kind !== 'dirawat') return null;
  const p = patientById(found.detail.summary.patientId);
  if (!p) return null;
  const step = await inpatientScenarioStep(s, p.scenario);
  return {
    meds: found.detail.medications,
    rm: p.rm,
    turn: step ? emarTurnBlocker(step.tasks.emar) : null,
  };
}

/**
 * Pindai gelang sebelum pemberian obat: kode dicocokkan dengan RM pasien kunjungan (atau override verifikasi manual
 * beralasan). Membuka grid eMAR; setiap dosis tetap diperiksa ulang saat dicatat.
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

/**
 * Catat pemberian SATU dosis eMAR (satu obat, satu slot). Obat, slot, status terlambat, dan sifat kewaspadaan tinggi
 * dibaca dari eMAR pasien di server; gelang dicocokkan dengan RM pasien (atau override beralasan) dan label obat
 * dengan obat slot. Jawaban membawa fakta dari rekam server (terlambat, cek ganda), bukan dari klien.
 */
export async function recordAdministrationAction(input: unknown): Promise<{
  ok?: { at: string; late: boolean; doubleCheckedBy: string | null };
  error?: string;
}> {
  const s = await demoActionSession();
  if (!canAdministerMeds(s.role?.code)) return { error: MED_ROLES };
  const parsed = emarAdministrationInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Pemberian obat tidak valid.' };
  const v = parsed.data;
  const rec = await emarRecord(s, v.encounterId);
  if (!rec) return { error: UNKNOWN };
  const blocked =
    rec.turn ?? emarRecordBlocker({ meds: rec.meds, rm: rec.rm, nurse: s.user.displayName, input: v });
  if (blocked) return { error: blocked };
  const med = rec.meds.find((m) => m.id === v.medicationId);
  if (!med) return { error: UNKNOWN };
  const at = await encounterClock(s, v.encounterId);
  return { ok: { at: formatJam(at), ...emarGivenFacts(med, v.time, v.doubleCheckedBy) } };
}
