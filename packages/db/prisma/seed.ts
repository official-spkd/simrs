/**
 * Seed data fiktif lokal: data rujukan contoh (P06) + tenant + struktur RS (P01) + pasien fiktif (P05). Idempoten (upsert per kode, ID
 * pasien tetap) sehingga aman diulang. Dijalankan sebagai simrs_migrator; karena FORCE RLS, tetap lewat withTenant.
 * RS: RSFA/RSFB (fiktif, juga dipakai tes) + RSCM (RS utama lokal; identitas asli, semua data fiktif).
 * Akun tidak pernah di-seed: `pnpm db:create-admin` / `pnpm db:create-demo` mencetak sandi sementara sekali.
 */
import { MORSE_FALL_SCALE, newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { ensureSystemRoles } from '../src/authz';
import { createPrismaClient, type PrismaClient, type TenantTx, withTenant } from '../src/client';
import { ensurePublishedForm } from '../src/forms';
import { detectDuplicates } from '../src/patient-match';
import { insertPatient } from '../src/patients';
import {
  SEED_LOCAL_TENANTS,
  SEED_PLATFORM_TENANT,
  SEED_ROOMS,
  SEED_TENANTS,
  SEED_UNITS,
} from '../src/seed-data';
import { seedPatients } from '../src/seed-patients';
import { seedRefSamples } from '../src/seed-ref';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error('MIGRATOR_DATABASE_URL belum disetel');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} belum disetel di .env (identitas pasien dienkripsi)`);
  return value;
}
const keys = { encKeyB64: requiredEnv('FIELD_ENCRYPTION_KEY'), hashKeyB64: requiredEnv('FIELD_HASH_KEY') };

/**
 * RS yang di-seed ke DB pengembangan + jumlah pasien fiktifnya. `index` menentukan rentang ID pasien tetap
 * (`0199a1<index>0-…`); RS dengan `duplicates` memuat pasangan kemungkinan duplikat untuk layar MPI.
 */
const TENANT_PLAN = [
  { tenant: SEED_TENANTS[0], index: 1, patients: 200, duplicates: true },
  { tenant: SEED_TENANTS[1], index: 2, patients: 30, duplicates: false },
  { tenant: SEED_LOCAL_TENANTS[0], index: 3, patients: 200, duplicates: true },
] as const;

/**
 * Satu transaksi per pasien: seed besar tidak menabrak batas waktu transaksi, dan tetap idempoten. Pasien
 * baru langsung diperiksa kemungkinan duplikatnya (antrean layar MPI), seperti pendaftaran lewat API.
 */
async function seedPatientsFor(
  prisma: PrismaClient,
  tenantId: string,
  plan: { index: number; patients: number; duplicates: boolean },
): Promise<{ created: number; candidates: number }> {
  const crypto = new PatientCrypto(keys, tenantId);
  const createdIds: string[] = [];
  const records = seedPatients(plan.index, plan.patients, plan.duplicates);
  for (const rec of records) {
    const created = await withTenant(prisma, tenantId, async (tx) => {
      const exists = await tx.patient.findUnique({ where: { id: rec.id }, select: { id: true } });
      if (exists) return false;
      await insertPatient(tx, crypto, rec);
      return true;
    });
    if (created) createdIds.push(rec.id);
  }
  // Basis data yang sudah berisi pasien seed sebelum deteksi duplikat ada (fase 1 potongan 7a): periksa semua
  // pasien seed sekali, selama RS ini belum punya kandidat sama sekali.
  const hasCandidates = await withTenant(prisma, tenantId, (tx) => tx.patientMatchCandidate.count());
  const toCheck = hasCandidates > 0 ? createdIds : records.map((r) => r.id);
  for (const id of toCheck) await withTenant(prisma, tenantId, (tx) => detectDuplicates(tx, crypto, id));
  const candidates = await withTenant(prisma, tenantId, (tx) =>
    tx.patientMatchCandidate.count({ where: { status: 'open' } }),
  );
  return { created: createdIds.length, candidates };
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
  // P06: contoh data rujukan (global, tanpa tenant) bila sistem kodenya masih kosong.
  const refAdded = await seedRefSamples(prisma);
  console.warn(`Data rujukan contoh (dari mockup) ditambahkan: ${refAdded} konsep`);
  for (const plan of TENANT_PLAN) {
    const t = plan.tenant;
    const form = await withTenant(prisma, t.id, async (tx) => {
      await tx.tenant.upsert({ where: { id: t.id }, update: { name: t.name }, create: { ...t } });
      await seedStructure(tx, t.id);
      await ensureSystemRoles(tx, t.id);
      // P07: formulir pustaka contoh (Morse dari mockup Formulir), versi 1 berlaku.
      return ensurePublishedForm(tx, t.id, MORSE_FALL_SCALE);
    });
    const patients = await seedPatientsFor(prisma, t.id, plan);
    console.warn(
      `Tenant siap: ${t.code} · ${t.name} (struktur RS: ${SEED_UNITS.length} unit, formulir Morse: ${form.created ? 'dipasang v1' : 'sudah ada'}, pasien fiktif baru: ${patients.created}, kandidat duplikat terbuka: ${patients.candidates})`,
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
