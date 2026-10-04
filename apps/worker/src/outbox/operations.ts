import {
  DUKCAPIL_VERIFY_OPERATION,
  NOTIFY_EMAIL_OPERATION,
  NOTIFY_WHATSAPP_OPERATION,
  TTE_SIGN_OPERATION,
} from '@simrs/shared';
import { dukcapilVerifyNik } from './dukcapil';
import { notifyEmail, notifyWhatsapp } from './notify';
import type { OutboxOperation } from './operation-types';
import { tteSignDocument } from './tte';

export type {
  HttpRequestSpec,
  OperationContext,
  OutboxMessageLike,
  OutboxOperation,
  PreparedRequest,
} from './operation-types';
export { PermanentOperationError } from './operation-types';

/**
 * Peta operasi outbox. Tambahkan operasi baru di sini (lihat Tutorial §6).
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
]);
