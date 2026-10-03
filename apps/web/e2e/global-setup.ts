import { prepareTestDatabase } from '@simrs/db/testing';

/** Migrasi tertunda + tenant fiktif (termasuk PLATFORM) ke simrs_test. Tidak destruktif. */
export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase();
}
