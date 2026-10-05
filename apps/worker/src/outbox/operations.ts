import {
  AUTH_BACKUP_CODE_OPERATION,
  BPJS_ANTREAN_ADD_OPERATION,
  BPJS_ANTREAN_BATAL_OPERATION,
  BPJS_ANTREAN_UPDATEWAKTU_OPERATION,
  PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION,
  BPJS_HFIS_PULL_OPERATION,
  BPJS_HFIS_UPDATE_OPERATION,
  DUKCAPIL_VERIFY_OPERATION,
  NOTIFY_EMAIL_OPERATION,
  NOTIFY_WHATSAPP_OPERATION,
  PATIENT_WHATSAPP_SCHEDULE_CHANGED_OPERATION,
  TTE_SIGN_OPERATION,
} from '@simrs/shared';
import { sendBackupCode } from './backup-code';
import { bpjsAntreanAdd, bpjsAntreanBatal, patientWhatsappBookingReminder } from './booking';
import { bpjsAntreanUpdateWaktu } from './bpjs-antrean';
import { dukcapilVerifyNik } from './dukcapil';
import { bpjsHfisPull, bpjsHfisUpdate } from './hfis';
import { notifyEmail, notifyWhatsapp } from './notify';
import type { OutboxOperation } from './operation-types';
import { patientWhatsappScheduleChanged } from './schedule-changed';
import { REFERRAL_OPERATIONS } from './referral';
import { SEP_OPERATIONS } from './sep';
import { tteSignDocument } from './tte';

export type {
  BpjsRequestSpec,
  HttpRequestSpec,
  OperationContext,
  OutboxDefer,
  OutboxMessageLike,
  OutboxOperation,
  PreparedRequest,
  RetryPolicy,
} from './operation-types';
export { PermanentOperationError } from './operation-types';
export { type BpjsOperationDefinition, type BpjsRejection, defineBpjsOperation } from './bpjs-operation';
export { endOfServiceDay, SERVICE_DAY_RETRY } from './retry-policy';

/** Token DI peta operasi (tes boleh menggantinya dengan peta berisi operasi uji). */
export const OUTBOX_OPERATION_REGISTRY = Symbol('OUTBOX_OPERATION_REGISTRY');

/**
 * Peta operasi outbox. Tambahkan operasi baru di sini (lihat Tutorial §6); operasi BPJS dibangun dengan
 * `defineBpjsOperation`.
 * Memakai Map, bukan objek biasa: nama operasi seperti `constructor`/`__proto__` tidak boleh
 * tak sengaja cocok dengan properti bawaan objek.
 */
export const OUTBOX_OPERATIONS: ReadonlyMap<string, OutboxOperation> = new Map<string, OutboxOperation>([
  [
    'ping',
    {
      prepare: (msg) => ({
        method: 'POST',
        path: `/${msg.target}/_echo`,
        body: { operation: msg.operation, payload: msg.payload },
      }),
    },
  ],
  [DUKCAPIL_VERIFY_OPERATION, dukcapilVerifyNik],
  [TTE_SIGN_OPERATION, tteSignDocument],
  [NOTIFY_EMAIL_OPERATION, notifyEmail],
  [NOTIFY_WHATSAPP_OPERATION, notifyWhatsapp],
  [AUTH_BACKUP_CODE_OPERATION, sendBackupCode],
  // F02 · Booking (potongan 3).
  [BPJS_ANTREAN_ADD_OPERATION, bpjsAntreanAdd],
  [BPJS_ANTREAN_BATAL_OPERATION, bpjsAntreanBatal],
  [PATIENT_WHATSAPP_BOOKING_REMINDER_OPERATION, patientWhatsappBookingReminder],
  // F04 · Task ID antrean (potongan 4a).
  [BPJS_ANTREAN_UPDATEWAKTU_OPERATION, bpjsAntreanUpdateWaktu],
  // F01 · Jadwal (potongan 2).
  [BPJS_HFIS_UPDATE_OPERATION, bpjsHfisUpdate],
  [BPJS_HFIS_PULL_OPERATION, bpjsHfisPull],
  [PATIENT_WHATSAPP_SCHEDULE_CHANGED_OPERATION, patientWhatsappScheduleChanged],
  // F06 · SEP (potongan 5a).
  ...SEP_OPERATIONS,
  // F06/F07 · Surat kontrol, SPRI, rujukan keluar (potongan 7).
  ...REFERRAL_OPERATIONS,
]);
