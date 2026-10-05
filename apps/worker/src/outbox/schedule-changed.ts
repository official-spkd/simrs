import { hhmmFromDbTime, isoFromDbDate } from '@simrs/db';
import {
  formatTanggal,
  messageAcceptedSchema,
  parseFrontOfficePayload,
  patientWhatsappText,
  toWallClock,
  type WhatsappSendRequest,
} from '@simrs/shared';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/**
 * F01 · `patient.whatsapp.schedule_changed`: beri tahu pasien bahwa jadwal kunjungannya berubah (cuti dokter,
 * pengalihan). Teks tanpa isi klinis (tanpa poli/dokter, keputusan fase 2 #8): RS, tanggal, jam, kode booking.
 * Data dibaca saat dikirim: booking yang sudah batal/selesai dilewati; no. HP pasien didekripsi di sini saja.
 */
export const patientWhatsappScheduleChanged: OutboxOperation = {
  sensitive: true,
  async prepare(msg, ctx) {
    let appointmentId: string;
    try {
      appointmentId = parseFrontOfficePayload('patient.whatsapp.schedule_changed', msg.payload).appointmentId;
    } catch {
      throw new PermanentOperationError('Payload pemberitahuan jadwal tidak dikenali');
    }
    const a = await ctx.read((tx) =>
      tx.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          bookingCode: true,
          status: true,
          appointmentDate: true,
          session: { select: { startTime: true } },
          patient: { select: { phoneEnc: true } },
          tenant: { select: { name: true } },
        },
      }),
    );
    if (!a) return { skip: 'booking tidak ditemukan' };
    if (a.status !== 'booked' && a.status !== 'checked_in') return { skip: `booking berstatus ${a.status}` };
    if (!a.patient.phoneEnc) return { skip: 'pasien tanpa no. HP' };
    let to: string;
    try {
      to = ctx.crypto.decryptContact(a.patient.phoneEnc);
    } catch {
      throw new PermanentOperationError('No. HP pasien tidak bisa dibaca');
    }
    const body: WhatsappSendRequest = {
      to,
      text: patientWhatsappText('schedule_changed', {
        hospitalName: a.tenant.name,
        dateLabel: formatTanggal(`${isoFromDbDate(a.appointmentDate)}T00:00:00Z`),
        time: toWallClock(hhmmFromDbTime(a.session.startTime)),
        bookingCode: a.bookingCode,
      }),
    };
    return { method: 'POST', path: '/whatsapp/send', body };
  },
  async onSuccess(_tx, _msg, responseBody) {
    let json: unknown;
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new PermanentOperationError('Respons pengirim pesan bukan JSON');
    }
    if (!messageAcceptedSchema.safeParse(json).success) {
      throw new PermanentOperationError('Respons pengirim pesan tidak dikenali');
    }
  },
};
