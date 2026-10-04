/**
 * Akun demo LOKAL dengan banyak posisi (keputusan pengguna 4 Okt 2026): satu akun, 16 penugasan (semua peran
 * bawaan, unit kerja seed yang sesuai), dipilih di langkah "Pilih posisi" saat masuk atau lewat "Ganti posisi".
 *
 *   pnpm db:create-demo --tenant RSCM --username demo.rscm --name "Akun Demo RSCM"
 *
 * Hanya APP_ENV=local (ditolak di staging/produksi atau bila APP_ENV tidak disetel): satu akun yang memegang semua
 * peran meniadakan pemisahan tugas, jadi tidak boleh ada di lingkungan bersama. Tidak ada sandi bawaan: kata sandi
 * sementara dicetak SEKALI, wajib diganti, dan MFA wajib didaftarkan saat masuk pertama.
 */
import { parseArgs } from 'node:util';
import { createUserSchema, newId, resolveAppEnv } from '@simrs/shared';
import { generateTemporaryPassword, hashPassword } from '@simrs/shared/node';
import { ensureSystemRoles } from '../src/authz';
import { createPrismaClient, withTenant } from '../src/client';
import { DEMO_POSITIONS } from '../src/seed-data';

const USAGE = 'Contoh: pnpm db:create-demo --tenant RSCM --username demo.rscm --name "Akun Demo RSCM"';

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

if (resolveAppEnv(process.env.APP_ENV) !== 'local') {
  fail('akun demo hanya untuk pengembangan lokal (APP_ENV=local)');
}

const { values } = parseArgs({
  options: { tenant: { type: 'string' }, username: { type: 'string' }, name: { type: 'string' } },
  strict: true,
});
const tenantCode = values.tenant?.trim().toUpperCase() ?? '';
if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(tenantCode)) fail(`--tenant wajib berisi kode RS\n${USAGE}`);
const parsed = createUserSchema.safeParse({ username: values.username, displayName: values.name });
if (!parsed.success) {
  fail(`${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}\n${USAGE}`);
}

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) fail('MIGRATOR_DATABASE_URL belum disetel (lihat .env.example)');

const prisma = createPrismaClient({ connectionString: url, max: 1 });
try {
  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true, name: true, kind: true, status: true },
  });
  if (!tenant) fail(`RS ${tenantCode} tidak ditemukan (jalankan pnpm db:seed lebih dulu)`);
  if (tenant.kind !== 'hospital' || tenant.status !== 'active') fail(`${tenant.code} bukan RS aktif`);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const userId = newId();
  const positions = await withTenant(prisma, tenant.id, async (tx) => {
    if (await tx.user.findFirst({ where: { username: parsed.data.username }, select: { id: true } })) {
      throw new Error(`nama pengguna ${parsed.data.username} sudah dipakai di ${tenant.code}`);
    }
    const roles = await ensureSystemRoles(tx, tenant.id, 'hospital');
    const units = new Map(
      (await tx.unit.findMany({ select: { id: true, code: true } })).map((u) => [u.code, u.id]),
    );
    await tx.user.create({
      data: {
        id: userId,
        tenantId: tenant.id,
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        mustChangePassword: true,
      },
    });
    await tx.userCredential.create({ data: { userId, tenantId: tenant.id, passwordHash } });
    const created: string[] = [];
    for (const [roleCode, unitCode] of DEMO_POSITIONS) {
      const roleId = roles.get(roleCode);
      if (!roleId) throw new Error(`Peran ${roleCode} tidak tersedia`);
      await tx.staffAssignment.create({
        data: {
          id: newId(),
          tenantId: tenant.id,
          userId,
          roleId,
          unitId: unitCode ? (units.get(unitCode) ?? null) : null,
        },
      });
      created.push(roleCode);
    }
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        resourceType: 'user',
        resourceId: userId,
        action: 'create',
        details: { via: 'cli', demo: true, positions: created.length },
      },
    });
    return created.length;
  });

  // Ke stdout (bukan log aplikasi): satu-satunya tempat sandi sementara pernah terlihat.
  process.stdout.write(
    `${[
      `Akun demo dibuat di ${tenant.code} · ${tenant.name}`,
      `  Posisi          : ${positions} (pilih saat masuk; bisa diganti lewat menu "Ganti posisi")`,
      `  Nama pengguna   : ${parsed.data.username}`,
      `  Sandi sementara : ${temporaryPassword}`,
      '',
      'Sandi sementara hanya ditampilkan sekali. Saat masuk pertama: daftarkan aplikasi autentikator, lalu ganti',
      'kata sandi. Akun demo hanya untuk lingkungan lokal; jangan dibuat di produksi.',
    ].join('\n')}\n`,
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await prisma.$disconnect();
}
