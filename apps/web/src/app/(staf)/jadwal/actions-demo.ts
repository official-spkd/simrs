'use server';

import { wallClockSchema } from '@simrs/shared';
import { z } from 'zod';
import { dirtyQuotaSlots, unsyncedLeaves } from '@/lib/front-office-jadwal';
import { frontOfficeActionSession } from '@/lib/server/data/front-office/shared';
import { frontOfficeStore, scheduleOf } from '@/lib/server/data/front-office/toko';
import { commitEvent } from '@/lib/server/demo/state';
import { demoWeeklySchedule } from '@/lib/demo/fixtures/front-office';

/**
 * Server Action layar Jadwal dokter (F01, mode presentasi ADR-0023): gerbang demo + sesi lengkap + posisi, input
 * divalidasi zod dan aturan kuota/cuti ditegakkan ulang di server dari jadwal yang sudah diterapkan toko. Perubahan
 * tersimpan di toko demo bersama (domain `jadwal`, ADR-0085) atas nama pengguna sesi dan berlaku di meja
 * pendaftaran, anjungan, dan info publik. HFIS tidak dipanggil (kiriman dicatat sebagai sudah terkirim).
 */

export interface ScheduleActionResult {
  ok: boolean;
  message: string;
  /** Jam aksi (`HH.MM`) bila berhasil. */
  at?: string;
  stale?: boolean;
}

const DENIED: ScheduleActionResult = { ok: false, message: 'Posisi Anda tidak memakai layar Jadwal dokter.' };
const rev = z.number().int().min(0);

async function scheduleFor() {
  const s = await frontOfficeActionSession('jadwal');
  if (!s) return null;
  const fo = await frontOfficeStore(s);
  return { s, fo, schedule: scheduleOf(fo) };
}

const fail = (r: { error: string; stale?: boolean }): ScheduleActionResult => ({
  ok: false,
  message: r.error,
  stale: r.stale,
});

const quotaSchema = z.strictObject({
  slotId: z.string().min(1).max(80),
  jkn: z.number().int().min(0).max(500),
  nonJkn: z.number().int().min(0).max(500),
  rev,
  jam: wallClockSchema,
});

/** Ubah kuota slot praktik (tidak boleh di bawah jumlah pasien yang sudah booking per penjamin). */
export async function changeQuotaAction(input: unknown): Promise<ScheduleActionResult> {
  const ctx = await scheduleFor();
  if (!ctx) return DENIED;
  const p = quotaSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Perubahan kuota tidak dikenali. Muat ulang halaman.' };
  const hit = ctx.schedule.doctors
    .flatMap((d) => d.slots.map((slot) => ({ slot, doctor: d.name })))
    .find((x) => x.slot.id === p.data.slotId);
  if (hit?.slot.kind !== 'praktik' || !hit.slot.quota) {
    return { ok: false, message: 'Slot tidak ditemukan atau tidak berkuota.' };
  }
  const q = hit.slot.quota;
  if (p.data.jkn < q.bookedJkn || p.data.nonJkn < q.bookedNonJkn) {
    return {
      ok: false,
      message: `Kuota ${hit.doctor} tidak boleh di bawah jumlah pasien yang sudah booking.`,
    };
  }
  const r = await commitEvent(
    'jadwal',
    { type: 'kuota.diubah', slotId: p.data.slotId, jkn: p.data.jkn, nonJkn: p.data.nonJkn, jam: p.data.jam },
    { rev: p.data.rev, session: ctx.s },
  );
  if (!r.ok) return fail(r);
  return {
    ok: true,
    at: p.data.jam,
    message: `Kuota ${hit.doctor} menjadi ${p.data.jkn} JKN + ${p.data.nonJkn} non-JKN · ${p.data.jam}`,
  };
}

/** "Perbarui jadwal ke HFIS": kirim cuti yang belum tercatat dan perubahan kuota. */
export async function sendScheduleToHfisAction(input: unknown): Promise<ScheduleActionResult> {
  const ctx = await scheduleFor();
  if (!ctx) return DENIED;
  const p = z.strictObject({ rev, jam: wallClockSchema }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Permintaan kiriman tidak dikenali. Muat ulang halaman.' };
  const st = ctx.fo.schedule.state;
  const n = dirtyQuotaSlots(demoWeeklySchedule(ctx.fo.progress), st).length;
  const leaves = unsyncedLeaves(st).length;
  if (st.fixtureSynced && n === 0 && leaves === 0) {
    return { ok: false, message: 'Jadwal RS dan HFIS sudah sama; tidak ada yang dikirim.' };
  }
  const r = await commitEvent(
    'jadwal',
    { type: 'hfis.dikirim', quotaChanges: n, jam: p.data.jam },
    { rev: p.data.rev, session: ctx.s },
  );
  if (!r.ok) return fail(r);
  return {
    ok: true,
    at: p.data.jam,
    message: `Jadwal terkirim ke HFIS${n ? ` (${n} perubahan kuota)` : ''} · ${p.data.jam}`,
  };
}

const leaveSchema = z.strictObject({
  slotId: z.string().min(1).max(80),
  substituteId: z.string().min(1).max(40).nullable(),
  reason: z.string().trim().min(5).max(300),
  rev,
  jam: wallClockSchema,
});

/** "+ Catat cuti atau pengganti": cuti pada slot praktik, opsional dengan dokter pengganti dari poli yang sama. */
export async function recordLeaveAction(input: unknown): Promise<ScheduleActionResult> {
  const ctx = await scheduleFor();
  if (!ctx) return DENIED;
  const parsed = leaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Isian cuti belum lengkap (alasan minimal 5 karakter).' };
  const { schedule } = ctx;
  const doctor = schedule.doctors.find((d) => d.slots.some((x) => x.id === parsed.data.slotId));
  const slot = doctor?.slots.find((x) => x.id === parsed.data.slotId);
  if (!doctor || slot?.kind !== 'praktik' || !slot.quota) {
    return { ok: false, message: 'Cuti hanya bisa dicatat pada slot praktik.' };
  }
  const sub = parsed.data.substituteId
    ? schedule.doctors.find((d) => d.id === parsed.data.substituteId)
    : null;
  if (parsed.data.substituteId && (!sub || sub.id === doctor.id || sub.poliCode !== doctor.poliCode)) {
    return { ok: false, message: 'Dokter pengganti harus dari poli yang sama.' };
  }
  const r = await commitEvent(
    'jadwal',
    {
      type: 'cuti.dicatat',
      slotId: slot.id,
      substituteId: sub?.id ?? null,
      reason: parsed.data.reason,
      jam: parsed.data.jam,
    },
    { rev: parsed.data.rev, session: ctx.s },
  );
  if (!r.ok) return fail(r);
  const booked = slot.quota.bookedJkn + slot.quota.bookedNonJkn;
  return {
    ok: true,
    at: parsed.data.jam,
    message: `Cuti ${doctor.name} tercatat${sub ? `, digantikan ${sub.name}` : ''}; ${booked} pasien perlu dialihkan · ${parsed.data.jam}`,
  };
}

/** "Tinjau pasien" pada dampak cuti: setujui pengalihan ke dokter pengganti + notifikasi WhatsApp. */
export async function approveLeaveTransferAction(input: unknown): Promise<ScheduleActionResult> {
  const ctx = await scheduleFor();
  if (!ctx) return DENIED;
  const p = z.strictObject({ slotId: z.string().min(1).max(80), rev, jam: wallClockSchema }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Slot cuti tidak dikenali.' };
  const slot = ctx.schedule.doctors.flatMap((d) => d.slots).find((x) => x.id === p.data.slotId);
  if (slot?.kind !== 'cuti' || !slot.relatedDoctorId) {
    return { ok: false, message: 'Slot ini bukan cuti dengan dokter pengganti.' };
  }
  const sub = ctx.schedule.doctors.find((d) => d.id === slot.relatedDoctorId)?.name ?? 'dokter pengganti';
  const patients = slot.affectedPatients ?? 0;
  const r = await commitEvent(
    'jadwal',
    { type: 'cuti.dialihkan', slotId: slot.id, patients, substituteName: sub, jam: p.data.jam },
    { rev: p.data.rev, session: ctx.s },
  );
  if (!r.ok) return fail(r);
  return {
    ok: true,
    at: p.data.jam,
    message: `${patients} pasien dialihkan ke ${sub}; notifikasi WhatsApp terkirim · ${p.data.jam}`,
  };
}
