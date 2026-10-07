/**
 * Seed data fiktif lokal: data rujukan contoh (P06) + tenant + struktur RS (P01) + pasien fiktif (P05) + staf fiktif
 * (P02/P03, fase 1 potongan 10d). Idempoten (upsert per kode, ID pasien tetap, staf per NIP) sehingga aman diulang.
 * Dijalankan sebagai simrs_migrator; karena FORCE RLS, tetap lewat withTenant.
 * RS: RSFA/RSFB (fiktif, juga dipakai tes) + RSCM (RS utama lokal; identitas asli, semua data fiktif).
 * Staf seed TIDAK punya kata sandi: tidak bisa masuk sampai admin SIM RS mereset sandinya di layar Akses. Akun yang
 * bisa langsung dipakai hanya lewat CLI: `pnpm db:create-admin` / `pnpm db:create-demo` mencetak sandi sementara sekali.
 */
import {
  CONSENT_TEMPLATE_SAMPLE,
  EDUCATION_FORM_SAMPLE,
  educationFormSupportsConsent,
  MORSE_FALL_SCALE,
} from '@simrs/shared';
import { loadFieldKeys, PatientCrypto } from '@simrs/shared/node';
import { ensureSystemRoles } from '../src/authz';
import { createPrismaClient, type PrismaClient, withTenant } from '../src/client';
import { ensurePublishedForm, upgradePublishedForm } from '../src/forms';
import { detectDuplicates } from '../src/patient-match';
import { insertPatient } from '../src/patients';
import { syncRolePermissions } from '../src/permission-sync';
import { SEED_LOCAL_TENANTS, SEED_PLATFORM_TENANT, SEED_TENANTS, SEED_UNITS } from '../src/seed-data';
import { seedPatients } from '../src/seed-patients';
import { seedRefSamples } from '../src/seed-ref';
import { seedClinicalHistory, seedClinicalMasters } from '../src/seed-clinical';
import { seedFrontOffice } from '../src/seed-front-office';
import { seedStaff } from '../src/seed-staff';
import { seedSupportMasters, seedSupportStock } from '../src/seed-support';
import { seedHospitalStructure } from '../src/seed-structure';

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) throw new Error('MIGRATOR_DATABASE_URL belum disetel');

// Identitas pasien dan no. HP staf dienkripsi dengan kunci aktif cincin (FIELD_*_KEYS, atau FIELD_*_KEY = v1).
const keys = loadFieldKeys(process.env);

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

const prisma = createPrismaClient({ connectionString: url, max: 2 });
try {
  // P06: contoh data rujukan (global, tanpa tenant) bila sistem kodenya masih kosong.
  const refAdded = await seedRefSamples(prisma);
  console.warn(`Data rujukan contoh (dari mockup) ditambahkan: ${refAdded} konsep`);
  for (const plan of TENANT_PLAN) {
    const t = plan.tenant;
    const form = await withTenant(prisma, t.id, async (tx) => {
      await tx.tenant.upsert({ where: { id: t.id }, update: { name: t.name }, create: { ...t } });
      await seedHospitalStructure(tx, t.id);
      await ensureSystemRoles(tx, t.id);
      // P03: izin yang baru di katalog (mis. izin fase 2) sampai ke peran RS yang sudah ada, seperti
      // `pnpm db:sync-permissions` (tidak mengembalikan izin yang dicabut admin).
      const sync = await syncRolePermissions(tx, t.id, 'hospital', { via: 'seed' });
      // P07: formulir pustaka contoh (Morse dari mockup Formulir), versi 1 berlaku. K11 (fase 3): templat persetujuan
      // tindakan (tujuh butir informasi) dan edukasi terintegrasi.
      await ensurePublishedForm(tx, t.id, CONSENT_TEMPLATE_SAMPLE);
      // Edukasi: versi lama tanpa topik `tindakan` dinaikkan (syarat final persetujuan, ADR-0058).
      await upgradePublishedForm(tx, t.id, EDUCATION_FORM_SAMPLE, educationFormSupportsConsent);
      return {
        ...(await ensurePublishedForm(tx, t.id, MORSE_FALL_SCALE)),
        permissionsAdded: sync.added.length,
      };
    });
    const patients = await seedPatientsFor(prisma, t.id, plan);
    // P02/P03: staf fiktif lintas peran, tanpa kata sandi (aktif setelah admin mereset sandinya).
    const staff = await seedStaff(prisma, t.id, { encRing: keys.enc });
    // F01–F04: layanan antrean, praktisi (tertaut staf seed), templat jadwal, penjamin, papan antrean.
    const fo = await seedFrontOffice(prisma, t.id);
    // K · Master klinis fase 3 (bed, obat, order set, KB CDS, singkatan, paket formulir) + riwayat fiktif.
    const clinical = await withTenant(prisma, t.id, (tx) => seedClinicalMasters(tx, t.id));
    const history = await seedClinicalHistory(prisma, t.id);
    // S01–S10 · Master penunjang fase 4 + stok awal fiktif (penerima barang = staf seed apoteker).
    const support = await withTenant(prisma, t.id, async (tx) => {
      const masters = await seedSupportMasters(tx, t.id);
      const pharmacist = await tx.staffAssignment.findFirst({
        where: { role: { code: 'apoteker' } },
        select: { userId: true },
      });
      const stock = pharmacist ? await seedSupportStock(tx, t.id, pharmacist.userId) : null;
      return { ...masters, stockBatches: stock?.batches ?? 0 };
    });
    console.warn(
      `Tenant siap: ${t.code} · ${t.name} (struktur RS: ${SEED_UNITS.length} unit, formulir Morse: ${form.created ? 'dipasang v1' : 'sudah ada'}, pasien fiktif baru: ${patients.created}, kandidat duplikat terbuka: ${patients.candidates}, staf fiktif baru: ${staff.created}, sudah ada: ${staff.existing})`,
    );
    console.warn(
      `  front office baru: ${fo.services} layanan antrean, ${fo.practitioners} praktisi, ${fo.schedules} templat jadwal, ${fo.payers} penjamin, ${fo.displays} papan antrean; izin katalog baru ke peran: ${form.permissionsAdded}`,
    );
    console.warn(
      `  klinis baru: ${clinical.beds} status bed, ${clinical.drugs} obat, ${clinical.orderables} item order, ${clinical.orderSets} order set, ${clinical.cdsRules} aturan CDS; riwayat fiktif ${history} kunjungan`,
    );
    console.warn(
      `  penunjang baru: ${support.labTests} tes lab, ${support.modalities} modalitas, ${support.stockLocations} depo, ${support.orRooms} kamar OK, ${support.stockBatches} batch obat`,
    );
  }
  const p = SEED_PLATFORM_TENANT;
  await withTenant(prisma, p.id, async (tx) => {
    await tx.tenant.upsert({ where: { id: p.id }, update: { name: p.name }, create: { ...p } });
    await ensureSystemRoles(tx, p.id, 'platform');
    await syncRolePermissions(tx, p.id, 'platform', { via: 'seed' });
  });
  console.warn(
    `Tenant siap: ${p.code} · ${p.name} (buat superadmin: pnpm db:create-admin --tenant ${p.code} …)`,
  );
  console.warn(
    'Staf fiktif belum bisa masuk (tanpa sandi). Aktifkan per orang lewat Pengguna & akses → Reset kata sandi (nama pengguna = NIP); akun admin pertama: pnpm db:create-admin.',
  );
} finally {
  await prisma.$disconnect();
}
