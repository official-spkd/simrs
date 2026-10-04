/** P08 · API dokumen dengan driver penyimpanan `disk` (bawaan APP_ENV=local). Isi tes di `documents.suite.ts`. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { documentsSuite } from './documents.suite';
import { TEST_STORAGE_ROOT } from './helpers';

documentsSuite({
  driver: 'disk',
  env: () => ({ STORAGE_DRIVER: 'disk', STORAGE_DISK_ROOT: TEST_STORAGE_ROOT }),
  tamper: (key, bytes) => writeFile(join(TEST_STORAGE_ROOT, ...key.split('/')), bytes),
});
