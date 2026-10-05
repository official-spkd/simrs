/**
 * Akun presentasi LOKAL (mode presentasi ADR-0023, permintaan pengguna 4 Okt 2026): 16 akun fiktif, satu per posisi,
 * yang bisa dipilih sekali klik di layar masuk saat `pnpm dev:demo`.
 *
 *   pnpm db:akun-presentasi                # RS bawaan RSCM
 *   pnpm db:akun-presentasi --tenant RSFA
 *
 * Hanya APP_ENV=local. Sandi acak + rahasia TOTP disimpan di `.local/demo-accounts.json` (diabaikan git, izin
 * berkas hanya pemilik) agar web bisa masuk otomatis lewat alur login biasa (sandi + kode verifikasi); API tidak
 * diberi jalan pintas. Menjalankan ulang mengganti semua kredensial. Jangan menyalin berkas itu ke tempat lain.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveAppEnv } from '@simrs/shared';
import { type KeyRing, loadFieldKeys } from '@simrs/shared/node';
import { createPrismaClient } from '../src/client';
import { upsertPresentationAccounts } from '../src/presentation';

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

if (resolveAppEnv(process.env.APP_ENV) !== 'local') {
  fail('akun presentasi hanya untuk pengembangan lokal (APP_ENV=local)');
}

const { values } = parseArgs({
  options: { tenant: { type: 'string' }, out: { type: 'string' } },
  strict: true,
});
const tenantCode = (values.tenant ?? 'RSCM').trim().toUpperCase();
if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(tenantCode)) fail('--tenant harus berisi kode RS, mis. RSCM');
const outFile = resolve(values.out ?? resolve(process.cwd(), '../../.local/demo-accounts.json'));

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) fail('MIGRATOR_DATABASE_URL belum disetel (lihat .env.example)');
let encRing: KeyRing;
try {
  encRing = loadFieldKeys(process.env).enc;
} catch (err) {
  fail(`${err instanceof Error ? err.message : 'Kunci kolom tidak valid'} (jalankan pnpm env:init)`);
}

const prisma = createPrismaClient({ connectionString: url, max: 1 });
try {
  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true, name: true, kind: true, status: true },
  });
  if (!tenant) fail(`RS ${tenantCode} tidak ditemukan (jalankan pnpm db:seed lebih dulu)`);
  if (tenant.kind !== 'hospital' || tenant.status !== 'active') fail(`${tenant.code} bukan RS aktif`);

  const accounts = await upsertPresentationAccounts(prisma, tenant.id, { encRing });
  await mkdir(dirname(outFile), { recursive: true });
  const body = { format: 1, tenantCode: tenant.code, createdAt: new Date().toISOString(), accounts };
  await writeFile(outFile, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outFile, 0o600).catch(() => undefined);

  process.stdout.write(
    `${[
      `Akun presentasi siap di ${tenant.code} · ${tenant.name}: ${accounts.length} posisi`,
      ...accounts.map((a) => `  ${a.roleName.padEnd(32)} ${a.displayName}`),
      '',
      `Kredensial (sandi + rahasia TOTP) tersimpan di ${outFile}. Jangan dibagikan atau di-commit.`,
      'Jalankan `pnpm dev:demo`, buka /masuk, lalu pilih akun di bagian "Masuk cepat · mode presentasi".',
    ].join('\n')}\n`,
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await prisma.$disconnect();
}
