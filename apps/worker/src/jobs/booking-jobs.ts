import { enqueueOutbox } from '@simrs/db';
import { isoDateJakarta, outboxKey, PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION } from '@simrs/shared';
import type { PeriodicJob } from './periodic-job-types';

const DAY_MS = 86_400_000;
const dbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * F02 · Tandai tidak hadir (`no_show`) booking yang tidak pernah check-in sampai akhir hari layanan WIB, dan batalkan
 * nomor antrean poli cadangannya. Kuota tidak dikembalikan (hari sudah lewat). Idempoten: hanya `booked` dengan
 * tanggal ≤ hari ini. Task 99 / batal Antrean BPJS untuk no-show belum dikirim dari sini (event domain hanya ada di
 * API; menyusul mesin task ID potongan 4a).
 */
export const bookingNoShowJob: PeriodicJob = {
  schedule: { dailyAt: '23:30' },
  module: 'F02',
  async run({ now, tx }) {
    const today = dbDate(isoDateJakarta(now));
    await tx(async (t) => {
      const ids = (
        await t.appointment.findMany({
          where: { status: 'booked', appointmentDate: { lte: today } },
          select: { id: true },
        })
      ).map((a) => a.id);
      if (ids.length === 0) return;
      await t.appointment.updateMany({
        where: { id: { in: ids }, status: 'booked' },
        data: { status: 'no_show' },
      });
      await t.queueTicket.updateMany({
        where: { appointmentId: { in: ids }, status: { in: ['waiting', 'skipped'] } },
        data: { status: 'cancelled' },
      });
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
    const tomorrow = dbDate(isoDateJakarta(new Date(now.getTime() + DAY_MS)));
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
