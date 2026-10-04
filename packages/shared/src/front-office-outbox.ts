import { z } from 'zod';
import type { IntegrationTarget } from './outbox';

/**
 * F01–F07 · Operasi outbox front office (ADR-0003, ADR-0017): nama operasi stabil + skema payload. Payload HANYA ID
 * baris domain (dan revisi bila perlu); worker membaca data terbaru saat `prepare`, sehingga PHI tidak tersimpan di
 * `outbox_messages`. Kontrak kawat BPJS (request/response VClaim, Antrean, HFIS) ada di `integrations/bpjs/**`.
 * Idempotency key: `outboxKey(operasi, id)` = `<operasi>:<id>` (satu pesan per baris domain per operasi).
 */

const id = z.uuid();

export const FRONT_OFFICE_OPERATIONS = {
  /** F02 · Tambah antrean ke BPJS (booking JKN, termasuk walk-in loket). */
  'bpjs.antrean.add': {
    target: 'bpjs',
    label: 'Tambah antrean BPJS',
    payload: z.strictObject({ appointmentId: id }),
  },
  /**
   * F04 · Update waktu task ID 1–7/99. Urutan per booking dijaga worker (`defer` bila task sebelumnya belum
   * terkirim); waktu task tidak pernah berubah.
   */
  'bpjs.antrean.updatewaktu': {
    target: 'bpjs',
    label: 'Update waktu task antrean BPJS',
    payload: z.strictObject({ queueTaskId: id }),
  },
  /** F02 · Batal antrean di BPJS. */
  'bpjs.antrean.batal': {
    target: 'bpjs',
    label: 'Batal antrean BPJS',
    payload: z.strictObject({ appointmentId: id }),
  },
  /**
   * F01 · Perbarui jadwal dokter × poli di HFIS. `revision` naik tiap perubahan jadwal: pesan dengan revisi lama
   * dilewati (`skip`) bila revisi lebih baru sudah ada.
   */
  'bpjs.hfis.update': {
    target: 'bpjs',
    label: 'Perbarui jadwal dokter HFIS',
    payload: z.strictObject({ practitionerId: id, unitId: id, revision: z.number().int().min(1) }),
  },
  /** F06 · Terbitkan SEP (cek SEP yang sudah ada di BPJS sebelum mengirim ulang; SEP tidak idempoten di BPJS). */
  'bpjs.vclaim.sep.insert': {
    target: 'bpjs',
    label: 'Terbitkan SEP',
    payload: z.strictObject({ sepId: id }),
  },
  /** F06 · Perbarui SEP (versi baru `seps`). */
  'bpjs.vclaim.sep.update': { target: 'bpjs', label: 'Perbarui SEP', payload: z.strictObject({ sepId: id }) },
  /** F06 · Hapus SEP di BPJS. */
  'bpjs.vclaim.sep.delete': { target: 'bpjs', label: 'Hapus SEP', payload: z.strictObject({ sepId: id }) },
  /** F06 · Rencana kontrol (surat kontrol) → `referrals` jenis `surat_kontrol`. */
  'bpjs.vclaim.rencanakontrol.insert': {
    target: 'bpjs',
    label: 'Buat rencana kontrol (surat kontrol)',
    payload: z.strictObject({ referralId: id }),
  },
  /** F06 · SPRI → `referrals` jenis `spri`. */
  'bpjs.vclaim.spri.insert': {
    target: 'bpjs',
    label: 'Buat SPRI',
    payload: z.strictObject({ referralId: id }),
  },
  /** F07 · Rujukan keluar / rujuk balik → `referrals` jenis `rujukan_keluar` | `rujukan_balik`. */
  'bpjs.vclaim.rujukan.insert': {
    target: 'bpjs',
    label: 'Buat rujukan keluar',
    payload: z.strictObject({ referralId: id }),
  },
  /**
   * F02 · Pengingat booking H-1 ke WhatsApp pasien (keputusan fase 2 no. 8). Teks dari `patientWhatsappText`: tanpa
   * isi klinis, tanpa nama poli/dokter. No. HP dibaca dan didekripsi worker dari kontak pasien saat mengirim.
   */
  'patient.whatsapp.booking_reminder': {
    target: 'whatsapp',
    label: 'Pengingat booking (WhatsApp pasien)',
    payload: z.strictObject({ appointmentId: id }),
  },
  /** F01 · Pemberitahuan perubahan jadwal karena cuti/pengalihan ke WhatsApp pasien. */
  'patient.whatsapp.schedule_changed': {
    target: 'whatsapp',
    label: 'Perubahan jadwal (WhatsApp pasien)',
    payload: z.strictObject({ appointmentId: id }),
  },
} as const satisfies Record<
  string,
  { target: IntegrationTarget; label: string; payload: z.ZodType<Record<string, unknown>> }
>;

export type FrontOfficeOperation = keyof typeof FRONT_OFFICE_OPERATIONS;
export type FrontOfficeOperationPayload<O extends FrontOfficeOperation> = z.infer<
  (typeof FRONT_OFFICE_OPERATIONS)[O]['payload']
>;

/** Konstanta per operasi (gaya `TTE_SIGN_OPERATION`, untuk peta operasi worker). */
export const BPJS_ANTREAN_ADD_OPERATION = 'bpjs.antrean.add' satisfies FrontOfficeOperation;
export const BPJS_ANTREAN_UPDATEWAKTU_OPERATION = 'bpjs.antrean.updatewaktu' satisfies FrontOfficeOperation;
export const BPJS_ANTREAN_BATAL_OPERATION = 'bpjs.antrean.batal' satisfies FrontOfficeOperation;
export const BPJS_HFIS_UPDATE_OPERATION = 'bpjs.hfis.update' satisfies FrontOfficeOperation;
export const BPJS_SEP_INSERT_OPERATION = 'bpjs.vclaim.sep.insert' satisfies FrontOfficeOperation;
export const BPJS_SEP_UPDATE_OPERATION = 'bpjs.vclaim.sep.update' satisfies FrontOfficeOperation;
export const BPJS_SEP_DELETE_OPERATION = 'bpjs.vclaim.sep.delete' satisfies FrontOfficeOperation;
export const BPJS_RENCANA_KONTROL_INSERT_OPERATION =
  'bpjs.vclaim.rencanakontrol.insert' satisfies FrontOfficeOperation;
export const BPJS_SPRI_INSERT_OPERATION = 'bpjs.vclaim.spri.insert' satisfies FrontOfficeOperation;
export const BPJS_RUJUKAN_INSERT_OPERATION = 'bpjs.vclaim.rujukan.insert' satisfies FrontOfficeOperation;
export const PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION =
  'patient.whatsapp.booking_reminder' satisfies FrontOfficeOperation;
export const PATIENT_WHATSAPP_SCHEDULE_CHANGED_OPERATION =
  'patient.whatsapp.schedule_changed' satisfies FrontOfficeOperation;

export function isFrontOfficeOperation(name: string): name is FrontOfficeOperation {
  return Object.hasOwn(FRONT_OFFICE_OPERATIONS, name);
}

/** Validasi payload sebelum diantrekan (dan di worker sebelum `prepare`). Melempar ZodError bila salah. */
export function parseFrontOfficePayload<O extends FrontOfficeOperation>(
  operation: O,
  payload: unknown,
): FrontOfficeOperationPayload<O> {
  return FRONT_OFFICE_OPERATIONS[operation].payload.parse(payload) as FrontOfficeOperationPayload<O>;
}

/** Idempotency key deterministik `<operasi>:<id>[:<revisi>]` (dedup di `outbox_messages`). */
export function outboxKey(operation: FrontOfficeOperation, rowId: string, revision?: number): string {
  return revision === undefined ? `${operation}:${rowId}` : `${operation}:${rowId}:${revision}`;
}

/**
 * Teks WhatsApp ke pasien: tanpa diagnosis, poli, atau dokter (nama poli bisa mengungkap kondisi). Cukup RS, tanggal,
 * jam, dan kode booking; detail lewat anjungan/loket/aplikasi.
 */
export function patientWhatsappText(
  kind: 'booking_reminder' | 'schedule_changed',
  v: { hospitalName: string; dateLabel: string; time: string; bookingCode: string },
): string {
  const head =
    kind === 'booking_reminder'
      ? `Pengingat kunjungan di ${v.hospitalName}: ${v.dateLabel} pukul ${v.time}.`
      : `Jadwal kunjungan Anda di ${v.hospitalName} berubah: ${v.dateLabel} pukul ${v.time}.`;
  return [
    head,
    `Kode booking: ${v.bookingCode}. Tunjukkan kode ini di anjungan atau loket pendaftaran.`,
    kind === 'schedule_changed' ? 'Bila tidak bisa hadir, hubungi loket pendaftaran untuk jadwal ulang.' : '',
    '— Pesan otomatis, jangan dibalas.',
  ]
    .filter(Boolean)
    .join('\n');
}
