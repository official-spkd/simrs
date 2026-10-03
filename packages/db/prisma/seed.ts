/**
 * Seed fase 0: 2 tenant RS fiktif. Dijalankan sebagai simrs_migrator; karena FORCE RLS, tetap lewat withTenant.
 * Staf dan pasien fiktif ditambahkan di fase 1.
 */
import { createPrismaClient, withTenant } from '../src/client';
import { SEED_TENANTS } from '../src/seed-data';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error('MIGRATOR_DATABASE_URL belum disetel');

const prisma = createPrismaClient({ connectionString: url, max: 2 });
try {
  for (const t of SEED_TENANTS) {
    await withTenant(prisma, t.id, (tx) =>
      tx.tenant.upsert({ where: { id: t.id }, update: { name: t.name }, create: { ...t } }),
    );
    console.warn(`Tenant siap: ${t.code} · ${t.name}`);
  }
} finally {
  await prisma.$disconnect();
}
