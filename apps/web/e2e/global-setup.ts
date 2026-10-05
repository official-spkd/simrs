import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPrismaClient, upsertPresentationAccounts } from '@simrs/db';
import { prepareTestDatabase, testDbUrls } from '@simrs/db/testing';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { registerTestDevices } from './support/devices';
import { e2eFieldKeys } from './support/field-keys';
import { resetMockState } from './support/mock';

/**
 * Berjalan setelah semua webServer menyala (mock, API, worker, web). Migrasi tertunda + tenant fiktif (termasuk
 * PLATFORM) ke simrs_test, lalu akun presentasi (ADR-0023) di RSFA uji dengan berkas kredensialnya untuk server web
 * mode presentasi, perangkat uji (belum ada, ADR-0027), dan mock dalam keadaan bersih. Tidak destruktif (kredensial
 * akun presentasi uji diganti setiap kali).
 */
export default async function globalSetup(): Promise<void> {
  await prepareTestDatabase();
  const prisma = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { code: 'RSFA' }, select: { id: true } });
    const accounts = await upsertPresentationAccounts(prisma, tenant.id, {
      encRing: e2eFieldKeys().enc,
    });
    const tmpDir = dirname(DEMO_ACCOUNTS_FILE);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      DEMO_ACCOUNTS_FILE,
      JSON.stringify({ format: 1, tenantCode: 'RSFA', createdAt: new Date().toISOString(), accounts }),
      { encoding: 'utf8', mode: 0o600 },
    );
    await registerTestDevices({ prisma, tenantId: tenant.id, tmpDir });
  } finally {
    await prisma.$disconnect();
  }
  await resetMockState();
}
