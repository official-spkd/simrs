import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPrismaClient, upsertPresentationAccounts } from '@simrs/db';
import { prepareTestDatabase, testDbUrls } from '@simrs/db/testing';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { ensureClinicalFixtures } from './support/clinical';
import { registerTestDevices } from './support/devices';
import { e2eFieldKeys } from './support/field-keys';
import { resetMockState } from './support/mock';
import { ensureStockFixtures } from './support/stock';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * Berjalan setelah semua webServer menyala (mock, API, worker, web). Migrasi tertunda + tenant fiktif (termasuk
 * PLATFORM) ke simrs_test, lalu akun presentasi (ADR-0023) di RSFA uji dengan berkas kredensialnya untuk server web
 * mode presentasi, perangkat uji anjungan/display (ADR-0027, `support/devices.ts`), dan mock dalam keadaan bersih. Tidak destruktif (kredensial
 * akun presentasi uji diganti setiap kali). Fase 3: fixture klinis (`support/clinical.ts`).
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
    // Fase 3: master klinis RSFA + akun DPJP/residen/perawat/admisi + pasien beralergi (`support/clinical.ts`).
    await ensureClinicalFixtures(prisma, tenant.id, tmpDir);
    // Fase 4: depo/gudang + stok awal fiktif + akun apoteker FARMASI dan IGD (`support/stock.ts`).
    await ensureStockFixtures(prisma, tenant.id, tmpDir);
  } finally {
    await prisma.$disconnect();
  }
  // F01–F04: poli, dokter (kode HFIS fiktif), templat, dan sesi 30 hari RSFA untuk spesifikasi jadwal/antrean/booking.
  await ensureRsfaSchedule();
  await resetMockState();
}
