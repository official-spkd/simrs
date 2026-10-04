'use server';

import { formatJam, ICD10_PATTERN, PAYERS } from '@simrs/shared';
import { z } from 'zod';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { LOCAL_SEP } from '@/lib/demo/fixtures/front-office';
import { deskQuota, referralExpired } from '@/lib/front-office';
import {
  frontOfficeActionSession,
  getDemoDeskPatients,
  getRegistrationDesk,
} from '@/lib/server/data/front-office';

/**
 * Server Action meja pendaftaran (F03/F06, mode presentasi ADR-0023) untuk pasien di luar skenario: gerbang demo +
 * sesi lengkap + posisi, input divalidasi zod, aturan (rujukan aktif, ICD-10, kuota, persetujuan umum) ditegakkan
 * ulang di server. Tidak ada yang disimpan; VClaim/Antrean BPJS tidak dipanggil.
 */

export interface RegistrationActionResult {
  ok: boolean;
  message: string;
  at?: string;
  sepNo?: string;
  queueNo?: string;
}

const DENIED: RegistrationActionResult = {
  ok: false,
  message: 'Posisi Anda tidak memakai layar Pendaftaran.',
};
const id = z.string().min(1).max(60);

/** Meja pendaftaran + pasien dummy yang bisa dicari (mode presentasi), atau null bila posisi tidak berhak. */
async function deskFor(screen: string) {
  const s = await frontOfficeActionSession(screen);
  if (!s) return null;
  const [desk, patients] = await Promise.all([getRegistrationDesk(s), getDemoDeskPatients()]);
  return { ...desk, patients };
}

export async function checkEligibilityAction(patientId: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const pid = id.safeParse(patientId);
  const p = pid.success ? desk.patients.find((x) => x.id === pid.data) : undefined;
  if (!p?.eligibility) return { ok: false, message: 'Pasien ini tidak tercatat sebagai peserta JKN.' };
  const at = formatJam(new Date());
  const e = p.eligibility;
  return { ok: true, at, message: `Peserta ${e.status} · ${e.kelas} ${e.segment} · ${at} (simulasi)` };
}

const sepSchema = z.strictObject({
  patientId: id,
  referralId: id,
  diagnosis: z.string().trim().min(1).max(120),
});

export async function issueSepAction(input: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const parsed = sepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Data SEP belum lengkap.' };
  const p = desk.patients.find((x) => x.id === parsed.data.patientId);
  const ref = p?.referrals.find((r) => r.id === parsed.data.referralId);
  if (!p?.eligibility || !ref) return { ok: false, message: 'Rujukan tidak ditemukan untuk pasien ini.' };
  if (referralExpired(ref, DEMO_TODAY)) return { ok: false, message: 'Rujukan sudah kedaluwarsa.' };
  const code = parsed.data.diagnosis.split(/[\s·]/)[0] ?? '';
  if (!ICD10_PATTERN.test(code)) return { ok: false, message: 'Diagnosa awal harus diawali kode ICD-10.' };
  const at = formatJam(new Date());
  return {
    ok: true,
    at,
    sepNo: LOCAL_SEP,
    message: `SEP ${LOCAL_SEP} terbit · ${at} (simulasi, tidak disimpan)`,
  };
}

const completeSchema = z.strictObject({
  patientId: id,
  payer: z.enum(PAYERS),
  doctorId: id,
  consent: z.literal(true),
});

export async function completeRegistrationAction(input: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Persetujuan umum dan dokter tujuan wajib ada.' };
  if (!desk.patients.some((x) => x.id === parsed.data.patientId)) {
    return { ok: false, message: 'Pasien tidak ditemukan.' };
  }
  const q = desk.quotas.find((x) => x.doctorId === parsed.data.doctorId);
  if (!q) return { ok: false, message: 'Dokter tidak praktik hari ini.' };
  if (deskQuota(q, parsed.data.payer, false).full)
    return { ok: false, message: 'Kuota dokter ini sudah penuh.' };
  const at = formatJam(new Date());
  return {
    ok: true,
    at,
    queueNo: q.nextQueueNo,
    message: `Terdaftar · antrean ${q.nextQueueNo} · ${at} (simulasi, tidak disimpan)`,
  };
}
