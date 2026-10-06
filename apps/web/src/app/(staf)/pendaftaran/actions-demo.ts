'use server';

import { formatJam, ICD10_PATTERN, PAYERS, wallClockSchema } from '@simrs/shared';
import { z } from 'zod';
import { LOCAL_SEP } from '@/lib/demo/fixtures/front-office';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { deskQuota, referralExpired } from '@/lib/front-office';
import {
  nextVisitId,
  REGISTRATION_CHARGE,
  visitOf,
  ALREADY_REGISTERED,
} from '@/lib/front-office-pendaftaran';
import { getDemoDeskPatients } from '@/lib/server/data/front-office/pendaftaran';
import { frontOfficeActionSession } from '@/lib/server/data/front-office/shared';
import { frontOfficeStore, loketOf, quotasOf } from '@/lib/server/data/front-office/toko';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * Server Action meja pendaftaran (F03/F06, mode presentasi ADR-0023) untuk pasien di luar skenario: gerbang demo +
 * sesi lengkap + posisi, input divalidasi zod, aturan (rujukan aktif, ICD-10, kuota, persetujuan umum, satu
 * kunjungan per pasien per hari) ditegakkan ulang di server dari data server. SEP, kunjungan, cetak, dan panggilan
 * loket tersimpan di toko demo bersama (domain `pendaftaran` dan `antrean`, ADR-0085) atas nama pengguna sesi;
 * VClaim/Antrean BPJS tidak dipanggil.
 */

export interface RegistrationActionResult {
  ok: boolean;
  message: string;
  at?: string;
  sepNo?: string;
  queueNo?: string;
  /** Tampilan basi (data berubah di tab/perangkat lain): halaman dimuat ulang. */
  stale?: boolean;
}

const DENIED: RegistrationActionResult = {
  ok: false,
  message: 'Posisi Anda tidak memakai layar Pendaftaran.',
};
const id = z.string().min(1).max(60);
const rev = z.number().int().min(0);

/** Sesi + keadaan front office + pasien dummy yang bisa dicari, atau null bila posisi tidak berhak. */
async function deskFor(screen: string) {
  const s = await frontOfficeActionSession(screen);
  if (!s) return null;
  const [fo, patients] = await Promise.all([frontOfficeStore(s), getDemoDeskPatients()]);
  return { s, fo, patients };
}

export async function checkEligibilityAction(patientId: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const pid = id.safeParse(patientId);
  const p = pid.success ? desk.patients.find((x) => x.id === pid.data) : undefined;
  if (!p?.eligibility) return { ok: false, message: 'Pasien ini tidak tercatat sebagai peserta JKN.' };
  const at = formatJam(new Date());
  const e = p.eligibility;
  return { ok: true, at, message: `Peserta ${e.status} · ${e.kelas} ${e.segment} · cek VClaim ${at}` };
}

const sepSchema = z.strictObject({
  patientId: id,
  referralId: id,
  diagnosis: z.string().trim().min(1).max(120),
  rev,
  jam: wallClockSchema,
});

/** Nomor SEP fiktif ke-n hari ini (format VClaim; SEP pertama = `LOCAL_SEP`). */
function sepNoAt(n: number): string {
  const base = Number(LOCAL_SEP.slice(-6));
  return `${LOCAL_SEP.slice(0, -6)}${String(base + n).padStart(6, '0')}`;
}

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
  const sepNo = sepNoAt(Object.keys(desk.fo.registration.state.seps).length);
  const r = await commitEvent(
    'pendaftaran',
    {
      type: 'sep.diterbitkan',
      patientId: p.id,
      referralId: ref.id,
      diagnosis: parsed.data.diagnosis,
      sepNo,
      jam: parsed.data.jam,
    },
    { rev: parsed.data.rev, session: desk.s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, at: parsed.data.jam, sepNo, message: `SEP ${sepNo} terbit · ${parsed.data.jam}` };
}

const completeSchema = z.strictObject({
  patientId: id,
  payer: z.enum(PAYERS),
  doctorId: id,
  consent: z.literal(true),
  rev,
  jam: wallClockSchema,
});

/**
 * Selesaikan pendaftaran: kunjungan rawat jalan baru (kontrak `kunjungan.terdaftar` untuk Poli dan charge
 * administrasi). Nomor antrean, sesi, SEP, dan tiket loket diambil dari data server, bukan dari klien.
 */
export async function completeRegistrationAction(input: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Persetujuan umum dan dokter tujuan wajib ada.' };
  const d = parsed.data;
  const p = desk.patients.find((x) => x.id === d.patientId);
  if (!p) return { ok: false, message: 'Pasien tidak ditemukan.' };
  const reg = desk.fo.registration.state;
  const done = visitOf(reg, p.id);
  if (done) return { ok: false, message: ALREADY_REGISTERED(done) };
  const q = quotasOf(desk.fo).find((x) => x.doctorId === d.doctorId);
  if (!q) return { ok: false, message: 'Dokter tidak praktik hari ini (libur atau cuti).' };
  if (deskQuota(q, d.payer, false).full) return { ok: false, message: 'Kuota dokter ini sudah penuh.' };
  const sep = d.payer === 'BPJS' ? reg.seps[p.id] : undefined;
  if (d.payer === 'BPJS' && !sep) return { ok: false, message: 'Terbitkan SEP dulu untuk pasien BPJS.' };
  const loket = loketOf(desk.fo).current;
  const r = await commitEvent(
    'pendaftaran',
    {
      type: 'kunjungan.terdaftar',
      visitId: nextVisitId(reg),
      patientId: p.id,
      rm: p.rm,
      patientName: p.name,
      payer: d.payer,
      poliCode: q.poliCode,
      poliName: q.poliName,
      room: q.room,
      doctorId: q.doctorId,
      doctorName: q.doctorName,
      sessionId: q.sessionId,
      queueNo: q.nextQueueNo,
      sepNo: sep?.sepNo ?? null,
      diagnosis: sep?.diagnosis ?? null,
      ticketNo: loket?.patientId === p.id ? loket.ticketNo : null,
      jam: d.jam,
      charge: {
        itemCode: REGISTRATION_CHARGE.itemCode,
        label: REGISTRATION_CHARGE.label,
        amount: REGISTRATION_CHARGE.amount.toString(),
      },
    },
    { rev: d.rev, session: desk.s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return {
    ok: true,
    at: d.jam,
    queueNo: q.nextQueueNo,
    message: `Terdaftar · antrean ${q.nextQueueNo} · ${d.jam}`,
  };
}

/** Cetak tiket poli, SEP, dan gelang (jejak cetak tersimpan per kunjungan). */
export async function printRegistrationAction(input: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const parsed = z.strictObject({ patientId: id, rev, jam: wallClockSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Permintaan cetak tidak dikenali.' };
  const v = visitOf(desk.fo.registration.state, parsed.data.patientId);
  if (!v) return { ok: false, message: 'Selesaikan pendaftaran sebelum mencetak.' };
  const r = await commitEvent(
    'pendaftaran',
    { type: 'kunjungan.dicetak', visitId: v.visitId, jam: parsed.data.jam },
    { rev: parsed.data.rev, session: desk.s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, at: parsed.data.jam, message: `Tercetak ${parsed.data.jam}` };
}

/**
 * "Panggil berikutnya" di loket: tiket berikutnya dihitung server (tiket booking anjungan dulu, lalu walk-in) dan
 * harus sama dengan nomor yang dilihat petugas; tampilan basi ditolak lewat revisi domain `antrean`.
 */
export async function callCounterAction(input: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const parsed = z.strictObject({ ticketNo: z.string().max(10), rev, jam: wallClockSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Panggilan loket tidak dikenali.' };
  const next = loketOf(desk.fo).next;
  if (next !== parsed.data.ticketNo) {
    return { ok: false, stale: true, message: `Antrean loket berubah; berikutnya ${next}.` };
  }
  const r = await commitEvent(
    'antrean',
    { type: 'tiket.dipanggil', ticketNo: next, counter: 'Loket 3', jam: parsed.data.jam },
    { rev: parsed.data.rev, session: desk.s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, at: parsed.data.jam, message: `${next} dipanggil ke Loket 3 · ${parsed.data.jam}` };
}

/** Permintaan bantuan anjungan ditangani petugas loket. */
export async function handleAssistAction(input: unknown): Promise<RegistrationActionResult> {
  const desk = await deskFor('daftar');
  if (!desk) return DENIED;
  const parsed = z.strictObject({ rev, jam: wallClockSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Permintaan tidak dikenali.' };
  const r = await commitEvent(
    'antrean',
    { type: 'bantuan.ditangani', jam: parsed.data.jam },
    { rev: parsed.data.rev, session: desk.s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, at: parsed.data.jam, message: `Bantuan anjungan ditangani · ${parsed.data.jam}` };
}
