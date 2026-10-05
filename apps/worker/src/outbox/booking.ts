import { hhmmFromDbTime, isoFromDbDate } from '@simrs/db';
import type { OutboxMessage, TenantTx } from '@simrs/db';
import {
  ANTREAN_ENDPOINTS,
  type AntreanAddRequest,
  type AntreanBatalRequest,
  BPJS_ANTREAN_ADD_OPERATION,
  formatTanggal,
  messageAcceptedSchema,
  normalizePhone,
  outboxKey,
  parseFrontOfficePayload,
  patientWhatsappText,
  type WhatsappSendRequest,
} from '@simrs/shared';
import { defineBpjsOperation } from './bpjs-operation';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/**
 * F02 · Operasi outbox booking: tambah/batal Antrean BPJS dan pengingat WhatsApp H-1. Payload hanya `appointmentId`
 * (ADR-0017); data (no. kartu, NIK, no. HP) dibaca dan didekripsi saat dikirim. Hasil BPJS dicatat di kolom status
 * kirim booking (`bpjs_sync_status` / `bpjs_cancel_status`), tanpa pesan BPJS mentah (bisa memuat data peserta).
 */

/** Kode galat status kirim saat pesan masuk DLQ (pesan untuk petugas ada di API, bukan di sini). */
export const BPJS_DLQ_CODE = 'BPJS_DLQ';

/** Ketiga operasi berpayload sama `{ appointmentId }` (`FRONT_OFFICE_OPERATIONS`). */
const idOf = (msg: { payload: unknown }) => {
  try {
    return parseFrontOfficePayload(BPJS_ANTREAN_ADD_OPERATION, msg.payload).appointmentId;
  } catch {
    throw new PermanentOperationError('Payload booking tidak dikenali');
  }
};

function setStatus(tx: TenantTx, id: string, data: Record<string, unknown>) {
  return tx.appointment.update({ where: { id }, data, select: { id: true } });
}

// ---------------------------------------------------------------------------------------------------------------
// bpjs.antrean.add
// ---------------------------------------------------------------------------------------------------------------

/** Tambah antrean ke BPJS untuk booking JKN (sudah dibatalkan pun tetap dikirim; batalnya menyusul berurutan). */
export const bpjsAntreanAdd: OutboxOperation = defineBpjsOperation({
  async prepare(msg, ctx) {
    const id = idOf(msg);
    const a = await ctx.read((tx) =>
      tx.appointment.findUnique({
        where: { id },
        select: {
          bookingCode: true,
          quotaBucket: true,
          jknVisitKind: true,
          referenceNumber: true,
          appointmentDate: true,
          estimatedAt: true,
          serviceId: true,
          practitionerId: true,
          patient: {
            select: {
              mrn: true,
              phoneEnc: true,
              identifiers: { where: { active: true }, select: { system: true, valueEnc: true } },
              _count: { select: { encounters: true } },
            },
          },
          session: {
            select: {
              startTime: true,
              endTime: true,
              quotaJkn: true,
              quotaNonJkn: true,
              bookedJkn: true,
              bookedNonJkn: true,
            },
          },
          service: { select: { name: true } },
          practitioner: { select: { name: true } },
          tickets: { where: { reserved: true }, select: { serviceId: true, ticketNo: true, seq: true } },
        },
      }),
    );
    if (!a) return { skip: 'booking tidak ditemukan' };
    if (a.quotaBucket !== 'jkn') return { skip: 'booking non-JKN tidak dikirim ke BPJS' };
    const ext = await ctx.read((tx) =>
      tx.externalId.findMany({
        where: {
          active: true,
          OR: [
            { entity: 'queue_service', entityId: a.serviceId, system: 'bpjs:poli' },
            { entity: 'practitioner', entityId: a.practitionerId, system: 'bpjs:hfis-dokter' },
          ],
        },
        select: { system: true, value: true },
      }),
    );
    const kodepoli = ext.find((e) => e.system === 'bpjs:poli')?.value;
    const kodedokter = Number(ext.find((e) => e.system === 'bpjs:hfis-dokter')?.value);
    if (!kodepoli || !Number.isInteger(kodedokter) || kodedokter <= 0) {
      throw new PermanentOperationError('Kode poli BPJS / kode dokter HFIS belum dipetakan');
    }
    const ident = (system: string) => a.patient.identifiers.find((i) => i.system === system)?.valueEnc;
    const kartuEnc = ident('bpjs');
    const nikEnc = ident('nik');
    if (!kartuEnc || !nikEnc) throw new PermanentOperationError('No. kartu BPJS atau NIK pasien tidak ada');
    if (!a.patient.phoneEnc) throw new PermanentOperationError('No. HP pasien tidak ada');
    const phone = normalizePhone(ctx.crypto.decryptContact(a.patient.phoneEnc));
    if (!phone) throw new PermanentOperationError('No. HP pasien tidak valid');
    const ticket = a.tickets.find((t) => t.serviceId === a.serviceId);
    if (!ticket) throw new PermanentOperationError('Nomor antrean poli booking tidak ada');
    const s = a.session;
    const body: AntreanAddRequest = {
      kodebooking: a.bookingCode,
      jenispasien: 'JKN',
      nomorkartu: ctx.crypto.decryptIdentifier(kartuEnc),
      nik: ctx.crypto.decryptIdentifier(nikEnc),
      nohp: phone,
      kodepoli,
      namapoli: a.service.name,
      pasienbaru: a.patient._count.encounters === 0 ? 1 : 0,
      norm: a.patient.mrn,
      tanggalperiksa: isoFromDbDate(a.appointmentDate),
      kodedokter,
      namadokter: a.practitioner.name,
      jampraktek: `${hhmmFromDbTime(s.startTime)}-${hhmmFromDbTime(s.endTime)}`,
      jeniskunjungan: (a.jknVisitKind ?? 1) as 1 | 2 | 3 | 4,
      nomorreferensi: a.referenceNumber ?? '',
      nomorantrean: ticket.ticketNo,
      angkaantrean: ticket.seq,
      estimasidilayani: (a.estimatedAt ?? new Date()).getTime(),
      sisakuotajkn: Math.max(0, s.quotaJkn - s.bookedJkn),
      kuotajkn: s.quotaJkn,
      sisakuotanonjkn: Math.max(0, s.quotaNonJkn - s.bookedNonJkn),
      kuotanonjkn: s.quotaNonJkn,
      keterangan: 'Peserta harap datang 30 menit lebih awal untuk pendaftaran.',
    };
    return { service: 'antrean', ...ANTREAN_ENDPOINTS.add, body };
  },
  async onAccepted(tx, msg) {
    await setStatus(tx, idOf(msg), { bpjsSyncStatus: 'sent', bpjsSyncedAt: new Date(), bpjsErrorCode: null });
  },
  async onRejected(tx, msg, rejection) {
    const id = idOf(msg);
    // Kode booking sudah terdaftar = kiriman sebelumnya sudah diterima (mis. timeout setelah BPJS memproses).
    if (rejection.code === 'BPJS_ANTREAN_GANDA') {
      await setStatus(tx, id, { bpjsSyncStatus: 'sent', bpjsSyncedAt: new Date(), bpjsErrorCode: null });
      return;
    }
    await setStatus(tx, id, { bpjsSyncStatus: 'rejected', bpjsErrorCode: rejection.code });
    await settleCancelIfNeverRegistered(tx, id);
  },
  async onDead(tx, msg) {
    const id = idOf(msg);
    await setStatus(tx, id, { bpjsSyncStatus: 'dead', bpjsErrorCode: BPJS_DLQ_CODE });
    await settleCancelIfNeverRegistered(tx, id);
  },
});

/** Booking yang tidak pernah terdaftar di BPJS tidak perlu dibatalkan di sana. */
async function settleCancelIfNeverRegistered(tx: TenantTx, id: string) {
  await tx.appointment.updateMany({
    where: { id, bpjsCancelStatus: 'pending' },
    data: { bpjsCancelStatus: 'not_required', bpjsCancelErrorCode: null },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// bpjs.antrean.batal
// ---------------------------------------------------------------------------------------------------------------

/**
 * Batal antrean di BPJS. Menunggu `bpjs.antrean.add` booking yang sama terkirim lebih dulu (`defer`); bila add
 * ditolak/DLQ (tidak pernah terdaftar di BPJS) batal dilewati.
 */
export const bpjsAntreanBatal: OutboxOperation = defineBpjsOperation({
  async prepare(msg, ctx) {
    const id = idOf(msg);
    const a = await ctx.read((tx) =>
      tx.appointment.findUnique({
        where: { id },
        select: { bookingCode: true, bpjsSyncStatus: true, cancelReason: true, status: true },
      }),
    );
    if (!a) return { skip: 'booking tidak ditemukan' };
    if (a.status !== 'cancelled') return { skip: 'booking tidak berstatus batal' };
    if (a.bpjsSyncStatus === 'pending') {
      const add = await ctx.findMessage({
        target: 'bpjs',
        idempotencyKey: outboxKey(BPJS_ANTREAN_ADD_OPERATION, id),
      });
      if (!add) return { skip: 'antrean belum pernah dikirim ke BPJS' };
      return { defer: { afterMessageId: add.id, reason: 'menunggu tambah antrean' } };
    }
    if (a.bpjsSyncStatus !== 'sent') return { skip: 'antrean tidak terdaftar di BPJS' };
    const body: AntreanBatalRequest = {
      kodebooking: a.bookingCode,
      // Alasan baku (bukan teks petugas, yang bisa memuat keterangan pasien).
      keterangan: 'Dibatalkan oleh rumah sakit',
    };
    return { service: 'antrean', ...ANTREAN_ENDPOINTS.batal, body };
  },
  async onAccepted(tx, msg) {
    await setStatus(tx, idOf(msg), { bpjsCancelStatus: 'sent', bpjsCancelErrorCode: null });
  },
  async onRejected(tx, msg, rejection) {
    const id = idOf(msg);
    if (rejection.code === 'BPJS_ANTREAN_SUDAH_BATAL') {
      await setStatus(tx, id, { bpjsCancelStatus: 'sent', bpjsCancelErrorCode: null });
    } else if (rejection.code === 'BPJS_ANTREAN_TIDAK_DITEMUKAN') {
      await setStatus(tx, id, { bpjsCancelStatus: 'not_required', bpjsCancelErrorCode: null });
    } else {
      await setStatus(tx, id, { bpjsCancelStatus: 'rejected', bpjsCancelErrorCode: rejection.code });
    }
  },
  async onDead(tx: TenantTx, msg: OutboxMessage) {
    const id = idOf(msg);
    const a = await tx.appointment.findUnique({ where: { id }, select: { bpjsSyncStatus: true } });
    await setStatus(
      tx,
      id,
      a?.bpjsSyncStatus === 'sent'
        ? { bpjsCancelStatus: 'dead', bpjsCancelErrorCode: BPJS_DLQ_CODE }
        : { bpjsCancelStatus: 'not_required', bpjsCancelErrorCode: null },
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------
// patient.whatsapp.booking_reminder
// ---------------------------------------------------------------------------------------------------------------

/**
 * Pengingat H-1 ke WhatsApp pasien (keputusan fase 2 #8): hanya RS, tanggal, jam, kode booking (`patientWhatsappText`),
 * tanpa poli/dokter/diagnosis. Dilewati bila booking sudah tidak aktif atau pasien tanpa no. HP.
 */
export const patientWhatsappBookingReminder: OutboxOperation = {
  sensitive: true,
  async prepare(msg, ctx) {
    const id = idOf(msg);
    const a = await ctx.read((tx) =>
      tx.appointment.findUnique({
        where: { id },
        select: {
          status: true,
          bookingCode: true,
          appointmentDate: true,
          estimatedAt: true,
          session: { select: { startTime: true } },
          patient: { select: { phoneEnc: true } },
          tenant: { select: { name: true } },
        },
      }),
    );
    if (!a) return { skip: 'booking tidak ditemukan' };
    if (a.status !== 'booked') return { skip: 'booking tidak lagi aktif' };
    if (!a.patient.phoneEnc) return { skip: 'pasien tidak punya no. HP' };
    let to: string | null;
    try {
      to = normalizePhone(ctx.crypto.decryptContact(a.patient.phoneEnc));
    } catch {
      throw new PermanentOperationError('No. HP pasien tidak bisa dibaca');
    }
    if (!to) return { skip: 'no. HP pasien tidak valid' };
    const date = isoFromDbDate(a.appointmentDate);
    const body: WhatsappSendRequest = {
      to,
      text: patientWhatsappText('booking_reminder', {
        hospitalName: a.tenant.name,
        dateLabel: formatTanggal(`${date}T12:00:00+07:00`),
        time: hhmmFromDbTime(a.session.startTime).replace(':', '.'),
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
