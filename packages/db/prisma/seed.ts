/**
 * Seed data fiktif lokal: tenant + struktur RS (P01). Idempoten (upsert per kode) sehingga aman diulang.
 * Dijalankan sebagai simrs_migrator; karena FORCE RLS, tetap lewat withTenant.
 * Staf dan pasien fiktif ditambahkan di potongan berikutnya fase 1.
 */
import { newId } from '@simrs/shared';
import { createPrismaClient, type TenantTx, withTenant } from '../src/client';
import { SEED_ROOMS, SEED_TENANTS, SEED_UNITS } from '../src/seed-data';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error('MIGRATOR_DATABASE_URL belum disetel');

async function seedStructure(tx: TenantTx, tenantId: string) {
  const facility = await tx.facility.upsert({
    where: { tenantId_code: { tenantId, code: 'UTAMA' } },
    update: {},
    create: { id: newId(), tenantId, code: 'UTAMA', name: 'Gedung Utama' },
  });
  const units = new Map<string, string>();
  for (const u of SEED_UNITS) {
    const row = await tx.unit.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: {},
      create: { id: newId(), tenantId, facilityId: facility.id, ...u },
    });
    units.set(u.code, row.id);
  }
  for (const [unitCode, code, name, careClass, beds] of SEED_ROOMS) {
    const unitId = units.get(unitCode);
    if (!unitId) throw new Error(`Unit seed ${unitCode} tidak ada`);
    const room = await tx.location.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { id: newId(), tenantId, unitId, kind: 'kamar', code, name, careClass },
    });
    for (let i = 0; i < beds; i++) {
      const letter = String.fromCharCode(65 + i);
      await tx.location.upsert({
        where: { tenantId_code: { tenantId, code: `${code}-${letter}` } },
        update: {},
        create: {
          id: newId(),
          tenantId,
          unitId,
          parentId: room.id,
          kind: 'bed',
          code: `${code}-${letter}`,
          name: `Bed ${letter}`,
          careClass,
        },
      });
    }
  }
}

const prisma = createPrismaClient({ connectionString: url, max: 2 });
try {
  for (const t of SEED_TENANTS) {
    await withTenant(prisma, t.id, async (tx) => {
      await tx.tenant.upsert({ where: { id: t.id }, update: { name: t.name }, create: { ...t } });
      await seedStructure(tx, t.id);
    });
    console.warn(`Tenant siap: ${t.code} · ${t.name} (struktur RS: ${SEED_UNITS.length} unit)`);
  }
} finally {
  await prisma.$disconnect();
}
