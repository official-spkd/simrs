import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Berkas kredensial akun presentasi uji (dibuat global setup, dibaca server web mode presentasi di :3011 atau E2E_DEMO_PORT).
 * Folder ini juga menyimpan keadaan simulasi uji; `E2E_TMP_NAME` memisahkannya antar-salinan repo. */
export const DEMO_ACCOUNTS_FILE = join(
  tmpdir(),
  process.env.E2E_TMP_NAME ?? 'simrs-demo-e2e',
  'demo-accounts.json',
);
