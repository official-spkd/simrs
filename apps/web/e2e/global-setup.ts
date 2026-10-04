import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPrismaClient, upsertPresentationAccounts } from '@simrs/db';
import { prepareTestDatabase, testDbUrls } from '@simrs/db/testing';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';

/**
 * Migrasi tertunda + tenant fiktif (termasuk PLATFORM) ke simrs_test, lalu akun presentasi (ADR-0023) di RSFA uji
 * dengan berkas kredensialnya untuk server web mode presentasi. Tidak destruktif (kredensial akun presentasi uji
 * diganti setiap kali).
 */
export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase();
  const prisma = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { code: 'RSFA' }, select: { id: true } });
    const accounts = await upsertPresentationAccounts(prisma, tenant.id, {
      encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '',
    });
    mkdirSync(dirname(DEMO_ACCOUNTS_FILE), { recursive: true });
    writeFileSync(
      DEMO_ACCOUNTS_FILE,
      JSON.stringify({ format: 1, tenantCode: 'RSFA', createdAt: new Date().toISOString(), accounts }),
      { encoding: 'utf8', mode: 0o600 },
    );
  } finally {
    await prisma.$disconnect();
  }
}
