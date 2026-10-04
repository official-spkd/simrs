'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { getWeeklySchedule } from '@/lib/server/data/front-office/jadwal';
import { frontOfficeActionSession } from '@/lib/server/data/front-office/shared';

/**
 * Server Action layar Jadwal dokter (F01, mode presentasi ADR-0023): gerbang demo + sesi lengkap + posisi,
 * input divalidasi zod dan aturan kuota ditegakkan ulang di server. Tidak ada yang disimpan atau dikirim ke HFIS.
 */

export interface ScheduleActionResult {
  ok: boolean;
  message: string;
  /** Jam aksi (`HH.MM`) bila berhasil. */
  at?: string;
}

const DENIED: ScheduleActionResult = { ok: false, message: 'Posisi Anda tidak memakai layar Jadwal dokter.' };

const changesSchema = z
  .array(
    z.strictObject({
      slotId: z.string().min(1).max(80),
      jkn: z.number().int().min(0).max(500),
      nonJkn: z.number().int().min(0).max(500),
    }),
  )
  .max(60);

/** "Perbarui jadwal ke HFIS": kirim cuti yang belum tercatat dan perubahan kuota (simulasi). */
export async function sendScheduleToHfisAction(changes: unknown): Promise<ScheduleActionResult> {
  const s = await frontOfficeActionSession('jadwal');
  if (!s) return DENIED;
  const parsed = changesSchema.safeParse(changes);
  if (!parsed.success) return { ok: false, message: 'Perubahan kuota tidak dikenali. Muat ulang halaman.' };
  const schedule = await getWeeklySchedule(s);
  const slots = new Map(
    schedule.doctors.flatMap((d) => d.slots.map((slot) => [slot.id, { slot, doctor: d.name }] as const)),
  );
  for (const c of parsed.data) {
    const hit = slots.get(c.slotId);
    if (!hit?.slot.quota) return { ok: false, message: 'Slot tidak ditemukan atau tidak berkuota.' };
    if (c.jkn < hit.slot.quota.bookedJkn || c.nonJkn < hit.slot.quota.bookedNonJkn) {
      return {
        ok: false,
        message: `Kuota ${hit.doctor} tidak boleh di bawah jumlah pasien yang sudah booking.`,
      };
    }
  }
  const at = formatJam(new Date());
  const n = parsed.data.length;
  return {
    ok: true,
    at,
    message: `Jadwal terkirim ke HFIS${n ? ` (${n} perubahan kuota)` : ''} · ${at} (simulasi, tidak disimpan)`,
  };
}

const leaveSchema = z.strictObject({
  slotId: z.string().min(1).max(80),
  substituteId: z.string().min(1).max(40).nullable(),
});

/** "+ Catat cuti atau pengganti": cuti pada slot praktik, opsional dengan dokter pengganti dari poli yang sama. */
export async function recordLeaveAction(input: unknown): Promise<ScheduleActionResult> {
  const s = await frontOfficeActionSession('jadwal');
  if (!s) return DENIED;
  const parsed = leaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Isian cuti tidak dikenali.' };
  const schedule = await getWeeklySchedule(s);
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
  const booked = slot.quota.bookedJkn + slot.quota.bookedNonJkn;
  const at = formatJam(new Date());
  return {
    ok: true,
    at,
    message: `Cuti ${doctor.name} tercatat${sub ? `, digantikan ${sub.name}` : ''}; ${booked} pasien perlu dialihkan · ${at} (simulasi, tidak disimpan)`,
  };
}

/** "Tinjau pasien" pada dampak cuti: setujui pengalihan ke dokter pengganti + notifikasi WhatsApp (simulasi). */
export async function approveLeaveTransferAction(slotId: unknown): Promise<ScheduleActionResult> {
  const s = await frontOfficeActionSession('jadwal');
  if (!s) return DENIED;
  const id = z.string().min(1).max(80).safeParse(slotId);
  if (!id.success) return { ok: false, message: 'Slot cuti tidak dikenali.' };
  const schedule = await getWeeklySchedule(s);
  const slot = schedule.doctors.flatMap((d) => d.slots).find((x) => x.id === id.data);
  if (slot?.kind !== 'cuti' || !slot.relatedDoctorId) {
    return { ok: false, message: 'Slot ini bukan cuti dengan dokter pengganti.' };
  }
  const sub = schedule.doctors.find((d) => d.id === slot.relatedDoctorId)?.name ?? 'dokter pengganti';
  const at = formatJam(new Date());
  return {
    ok: true,
    at,
    message: `${slot.affectedPatients ?? 0} pasien dialihkan ke ${sub}; notifikasi WhatsApp terkirim · ${at} (simulasi, tidak disimpan)`,
  };
}
