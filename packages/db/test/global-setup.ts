import { prepareTestDatabase } from '../src/testing';

/** Migrasi tertunda + tenant fiktif ke simrs_test (tidak destruktif). Gagal keras bila Postgres mati. */
export default async function setup() {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
  await prepareTestDatabase();
}
