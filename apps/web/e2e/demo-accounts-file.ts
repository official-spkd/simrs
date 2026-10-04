import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Berkas kredensial akun presentasi uji (dibuat global setup, dibaca server web mode presentasi di :3011). */
export const DEMO_ACCOUNTS_FILE = join(tmpdir(), 'simrs-demo-e2e', 'demo-accounts.json');
