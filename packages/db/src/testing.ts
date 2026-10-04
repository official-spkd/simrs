/**
 * Utilitas tes integrasi (bukan untuk kode aplikasi). Diekspor lewat `@simrs/db/testing`.
 *
 * Prinsip: persiapan DB tes TIDAK destruktif. Hanya `prisma migrate deploy` (menerapkan migrasi tertunda)
 * dan upsert tenant fiktif. Setiap tes wajib memakai ID/kunci unik sehingga tidak bergantung pada DB kosong.
 * Bila migrasi lama diubah dan DB tes perlu dibuat ulang, pengembang menjalankan `pnpm db:test:recreate` sendiri.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSystemRoles } from './authz';
import { createPrismaClient, withTenant } from './client';
import { seedRefSamples } from './seed-ref';
import { SEED_PLATFORM_TENANT, SEED_TENANTS } from './seed-data';

export { SEED_PLATFORM_TENANT, SEED_TENANTS };

export interface TestDbUrls {
  /** simrs_migrator → simrs_test: untuk migrasi dan seed. */
  migrator: string;
  /** simrs_app → simrs_test: untuk tes (tanpa BYPASSRLS). */
  app: string;
}

export function testDbUrls(env: Record<string, string | undefined> = process.env): TestDbUrls {
  return {
    migrator:
      env.TEST_DATABASE_URL ??
      'postgresql://simrs_migrator:migrator_local@localhost:5432/simrs_test?schema=public',
    app:
      env.TEST_APP_DATABASE_URL ?? 'postgresql://simrs_app:app_local@localhost:5432/simrs_test?schema=public',
  };
}

/**
 * Nama database tes: `simrs_test`, atau `simrs_test_<nama>` untuk salinan repo paralel (git worktree) yang
 * masing-masing punya database tes sendiri. Disalin di `scripts/recreate-test-db.mjs`.
 */
export const TEST_DATABASE_NAME = /^simrs_test(?:_[a-z0-9_]+)?$/;

/** Pengaman: hanya database tes (lihat `TEST_DATABASE_NAME`) yang boleh disentuh oleh persiapan tes. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(
      `Persiapan tes menolak database "${name}"; hanya simrs_test atau simrs_test_<nama> yang diizinkan.`,
    );
  }
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Terapkan migrasi tertunda + seed tenant fiktif ke simrs_test. Idempoten dan tidak menghapus data. */
export async function prepareTestDatabase(urls: TestDbUrls = testDbUrls()): Promise<void> {
  assertTestDatabase(urls.migrator);
  assertTestDatabase(urls.app);
  const prismaCli = createRequire(resolve(packageRoot, 'package.json')).resolve('prisma/build/index.js');
  try {
    // Tanpa shell: argumen tidak pernah diinterpretasi ulang (aman dari injeksi), lintas platform.
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: packageRoot,
      env: { ...process.env, MIGRATOR_DATABASE_URL: urls.migrator },
      stdio: 'pipe',
    });
  } catch (err) {
    const out = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate deploy gagal untuk simrs_test. Apakah Postgres berjalan (docker compose up -d atau pnpm pg:portable)?\n${out.stderr?.toString() ?? ''}${out.stdout?.toString() ?? ''}`,
      { cause: err },
    );
  }
  const prisma = createPrismaClient({ connectionString: urls.migrator, max: 2 });
  try {
    // Contoh data rujukan global (P06) agar tes API/E2E punya kode ICD/LOINC/KFA; idempoten.
    await seedRefSamples(prisma);
    for (const t of SEED_TENANTS) {
      await withTenant(prisma, t.id, async (tx) => {
        await tx.tenant.upsert({ where: { id: t.id }, update: {}, create: { ...t } });
        await ensureSystemRoles(tx, t.id);
      });
    }
    const p = SEED_PLATFORM_TENANT;
    await withTenant(prisma, p.id, async (tx) => {
      await tx.tenant.upsert({ where: { id: p.id }, update: {}, create: { ...p } });
      await ensureSystemRoles(tx, p.id, 'platform');
    });
  } finally {
    await prisma.$disconnect();
  }
}
