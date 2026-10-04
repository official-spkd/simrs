import { randomUUID } from 'node:crypto';
import { prepareTestDatabase } from '@simrs/db/testing';
import { Redis } from 'ioredis';

/**
 * Migrasi tertunda + tenant fiktif ke simrs_test (tidak destruktif). Gagal keras bila Postgres mati.
 * Juga menetapkan awalan kunci Redis batas laju khusus run ini (dibaca `createTestApp`, diwariskan ke proses tes),
 * lalu di akhir menghapus hanya kunci berawalan itu.
 */
export default async function setup() {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
  await prepareTestDatabase();
  const prefix = `simrs:rl:test:${randomUUID()}:`;
  process.env.SIMRS_TEST_RATE_LIMIT_PREFIX = prefix;
  return () => deleteRateLimitKeys(prefix);
}

async function deleteRateLimitKeys(prefix: string): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      if (keys.length > 0) await redis.unlink(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // Redis tidak ada (pengembangan tanpa Docker): tidak ada kunci yang perlu dihapus.
  } finally {
    redis.disconnect();
  }
}
