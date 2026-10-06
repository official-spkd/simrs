'use server';

import { z } from 'zod';
import { bookingCode, APP_PATIENT_ID, patientAppEventSchema } from '@/lib/aplikasi-pasien-toko';
import { jamSchema } from '@/lib/backoffice-toko';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';
import { frontOfficeStore, scheduleOf } from '@/lib/server/data/front-office/toko';
import { bookableSlots } from '@/lib/server/data/manajemen';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * I07 · Server Action pratinjau aplikasi pasien (mode presentasi, ADR-0023/0085). Booking: slot dicari server dari
 * Jadwal dokter (kuota JKN tersisa, bukan cuti), kode booking dihitung dari keadaan toko. Aksi lain (gula darah,
 * akses keluarga, batal booking) divalidasi skema + gerbang domain `aplikasi-pasien`.
 */

export interface PatientAppActionResult {
  ok: boolean;
  message: string;
  stale?: boolean;
}

const rev = z.number().int().min(0);

export async function bookSlotAction(input: unknown): Promise<PatientAppActionResult> {
  const s = await manajemenSession('app-pasien');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  const p = z.strictObject({ slotId: z.string().min(1).max(80), jam: jamSchema, rev }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Pilihan jadwal tidak sah.' };
  const [fo, store] = await Promise.all([frontOfficeStore(s), readDomain('aplikasi-pasien')]);
  const slot = bookableSlots(scheduleOf(fo)).find((x) => x.slotId === p.data.slotId);
  if (!slot) return { ok: false, message: 'Jadwal ini tidak tersedia lagi (penuh, cuti, atau sudah lewat).' };
  const code = bookingCode(store.state.seq);
  const r = await commitEvent(
    'aplikasi-pasien',
    {
      type: 'booking.dibuat',
      code,
      patientId: APP_PATIENT_ID,
      slotId: slot.slotId,
      doctorId: slot.doctorId,
      doctorName: slot.doctorName,
      poliCode: slot.poliCode,
      poliName: slot.poliName,
      date: slot.date,
      start: slot.start,
      jam: p.data.jam,
    },
    { rev: p.data.rev, session: s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, message: `Booking ${code} terdaftar · ${slot.poliName} · ${slot.date} ${slot.start}.` };
}

const otherEvent = patientAppEventSchema.refine((e) => e.type !== 'booking.dibuat', {
  message: 'Booking lewat pilihan jadwal.',
});

export async function patientAppAction(input: unknown): Promise<PatientAppActionResult> {
  const s = await manajemenSession('app-pasien');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  const p = z.strictObject({ event: otherEvent, rev }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Isian tidak sah.' };
  const r = await commitEvent('aplikasi-pasien', p.data.event, { rev: p.data.rev, session: s });
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, message: 'Tersimpan.' };
}
