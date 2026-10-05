import { dbDateFromIso, enqueueOutbox, insertBpjsQueueTask } from '@simrs/db';
import {
  ANTREAN_TASK_BATAL,
  isoDateJakarta,
  outboxKey,
  PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION,
} from '@simrs/shared';
import type { PeriodicJob } from './periodic-job-types';

const DAY_MS = 86_400_000;

/**
 * F02 · Tandai tidak hadir (`no_show`) booking yang tidak pernah check-in sampai akhir hari layanan WIB, dan batalkan
 * nomor antrean poli cadangannya. Kuota tidak dikembalikan (hari sudah lewat). Idempoten: hanya `booked` dengan
 * tanggal ≤ hari ini. Booking JKN mendapat task 99 (waktu = saat job, `insertBpjsQueueTask`, sama dengan mesin task ID
 * API) bila belum ada task 99; dikirim worker lewat `bpjs.antrean.updatewaktu` setelah task sebelumnya (`defer`).
 */
export const bookingNoShowJob: PeriodicJob = {
  schedule: { dailyAt: '23:30' },
  module: 'F02',
  async run({ tenantId, now, tx }) {
    const today = dbDateFromIso(isoDateJakarta(now));
    await tx(async (t) => {
      const rows = await t.appointment.findMany({
        where: { status: 'booked', appointmentDate: { lte: today } },
        select: { id: true, quotaBucket: true },
      });
      const ids = rows.map((a) => a.id);
      if (ids.length === 0) return;
      await t.appointment.updateMany({
        where: { id: { in: ids }, status: 'booked' },
        data: { status: 'no_show' },
      });
      await t.queueTicket.updateMany({
        where: { appointmentId: { in: ids }, status: { in: ['waiting', 'skipped'] } },
        data: { status: 'cancelled' },
      });
      for (const a of rows) {
        if (a.quotaBucket === 'jkn') await insertBpjsQueueTask(t, tenantId, a.id, ANTREAN_TASK_BATAL, now);
      }
    });
  },
};

/**
 * F02 · Pengingat WhatsApp H-1 (keputusan fase 2 #8) untuk booking aktif besok (WIB). Satu pesan per booking:
 * kunci idempotensi outbox `patient.whatsapp.booking_reminder:<id>`, jadi aman bila job terulang.
 */
export const bookingReminderJob: PeriodicJob = {
  schedule: { dailyAt: '18:00' },
  module: 'F02',
  async run({ tenantId, now, tx }) {
    const tomorrow = dbDateFromIso(isoDateJakarta(new Date(now.getTime() + DAY_MS)));
    await tx(async (t) => {
      const rows = await t.appointment.findMany({
        where: { status: 'booked', appointmentDate: tomorrow, patient: { phoneEnc: { not: null } } },
        select: { id: true },
      });
      for (const a of rows) {
        await enqueueOutbox(t, tenantId, {
          target: 'whatsapp',
          operation: PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION,
          idempotencyKey: outboxKey(PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION, a.id),
          payload: { appointmentId: a.id },
        });
      }
    });
  },
};
