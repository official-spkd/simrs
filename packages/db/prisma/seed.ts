/**
 * Seed data fiktif lokal: tenant + struktur RS (P01) + pasien fiktif (P05). Idempoten (upsert per kode, ID
 * pasien tetap) sehingga aman diulang. Dijalankan sebagai simrs_migrator; karena FORCE RLS, tetap lewat withTenant.
 * Staf fiktif ditambahkan di potongan berikutnya fase 1.
 */
import { newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { ensureSystemRoles } from '../src/authz';
import { createPrismaClient, type PrismaClient, type TenantTx, withTenant } from '../src/client';
import { insertPatient } from '../src/patients';
import { SEED_PLATFORM_TENANT, SEED_ROOMS, SEED_TENANTS, SEED_UNITS } from '../src/seed-data';
import { seedPatients } from '../src/seed-patients';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error('MIGRATOR_DATABASE_URL belum disetel');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} belum disetel di .env (identitas pasien dienkripsi)`);
  return value;
}
const keys = { encKeyB64: requiredEnv('FIELD_ENCRYPTION_KEY'), hashKeyB64: requiredEnv('FIELD_HASH_KEY') };

/** Jumlah pasien fiktif per RS seed (RS pertama memuat pasangan duplikat untuk layar MPI). */
const PATIENTS_PER_TENANT = [200, 30] as const;

/** Satu transaksi per pasien: seed besar tidak menabrak batas waktu transaksi, dan tetap idempoten. */
async function seedPatientsFor(prisma: PrismaClient, tenantId: string, index: number): Promise<number> {
  const crypto = new PatientCrypto(keys, tenantId);
  let created = 0;
  for (const rec of seedPatients(index + 1, PATIENTS_PER_TENANT[index] ?? 0, index === 0)) {
    created += await withTenant(prisma, tenantId, async (tx) => {
      const exists = await tx.patient.findUnique({ where: { id: rec.id }, select: { id: true } });
      if (exists) return 0;
      await insertPatient(tx, crypto, rec);
      return 1;
    });
  }
  return created;
}

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
  for (const [index, t] of SEED_TENANTS.entries()) {
    await withTenant(prisma, t.id, async (tx) => {
      await tx.tenant.upsert({ where: { id: t.id }, update: { name: t.name }, create: { ...t } });
      await seedStructure(tx, t.id);
      await ensureSystemRoles(tx, t.id);
    });
    const patients = await seedPatientsFor(prisma, t.id, index);
    console.warn(
      `Tenant siap: ${t.code} · ${t.name} (struktur RS: ${SEED_UNITS.length} unit, pasien fiktif baru: ${patients})`,
    );
  }
  const p = SEED_PLATFORM_TENANT;
  await withTenant(prisma, p.id, async (tx) => {
    await tx.tenant.upsert({ where: { id: p.id }, update: { name: p.name }, create: { ...p } });
    await ensureSystemRoles(tx, p.id, 'platform');
  });
  console.warn(
    `Tenant siap: ${p.code} · ${p.name} (buat superadmin: pnpm db:create-admin --tenant ${p.code} …)`,
  );
} finally {
  await prisma.$disconnect();
}
