/**
 * Buat akun admin pertama sebuah tenant: `admin_tenant` di RS, `superadmin_platform` di tenant PLATFORM.
 *
 *   pnpm db:create-admin --tenant RSFA --username admin.rsfa --name "Admin SIM RS"
 *   pnpm db:create-admin --tenant PLATFORM --username superadmin --name "Operator Platform"
 *
 * Tidak ada akun bawaan berkata sandi tetap: kata sandi sementara dicetak SEKALI di sini, wajib diganti, dan
 * verifikasi dua langkah wajib didaftarkan saat login pertama. Dijalankan operator dengan role migrator
 * (pemilik tabel), tetap lewat withTenant karena FORCE RLS. Pembuatan akun tercatat di jejak audit.
 */
import { parseArgs } from 'node:util';
import { createUserSchema, newId } from '@simrs/shared';
import { generateTemporaryPassword, hashPassword } from '@simrs/shared/node';
import { ensureSystemRoles } from '../src/authz';
import { createPrismaClient, withTenant } from '../src/client';

const USAGE = 'Contoh: pnpm db:create-admin --tenant RSFA --username admin.rsfa --name "Admin SIM RS"';

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    username: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
  },
  strict: true,
});
const tenantCode = values.tenant?.trim().toUpperCase() ?? '';
if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(tenantCode))
  fail(`--tenant wajib berisi kode tenant yang valid\n${USAGE}`);
// Aturan yang sama dengan pembuatan pengguna lewat API (nama pengguna, nama tampilan, email).
const parsed = createUserSchema.safeParse({
  username: values.username,
  displayName: values.name,
  email: values.email,
});
if (!parsed.success) {
  fail(`${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}\n${USAGE}`);
}
const args = {
  tenant: tenantCode,
  username: parsed.data.username,
  name: parsed.data.displayName,
  email: parsed.data.email,
};

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) fail('MIGRATOR_DATABASE_URL belum disetel (lihat .env.example)');

const prisma = createPrismaClient({ connectionString: url, max: 1 });
try {
  // `tenants` adalah registri tanpa FORCE RLS: pemilik tabel boleh membacanya tanpa konteks tenant.
  const tenant = await prisma.tenant.findUnique({
    where: { code: args.tenant },
    select: { id: true, code: true, name: true, kind: true, status: true },
  });
  if (!tenant)
    fail(`tenant ${args.tenant} tidak ditemukan (jalankan pnpm db:seed untuk tenant fiktif lokal)`);
  if (tenant.status !== 'active') fail(`tenant ${tenant.code} tidak aktif`);
  const kind = tenant.kind === 'platform' ? 'platform' : 'hospital';
  const roleCode = kind === 'platform' ? 'superadmin_platform' : 'admin_tenant';

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const userId = newId();
  await withTenant(prisma, tenant.id, async (tx) => {
    const roleId = (await ensureSystemRoles(tx, tenant.id, kind)).get(roleCode);
    if (!roleId) throw new Error(`Peran ${roleCode} tidak tersedia`);
    if (await tx.user.findFirst({ where: { username: args.username }, select: { id: true } })) {
      throw new Error(`nama pengguna ${args.username} sudah dipakai di ${tenant.code}`);
    }
    await tx.user.create({
      data: {
        id: userId,
        tenantId: tenant.id,
        username: args.username,
        displayName: args.name,
        email: args.email ?? null,
        mustChangePassword: true,
      },
    });
    await tx.userCredential.create({ data: { userId, tenantId: tenant.id, passwordHash } });
    await tx.staffAssignment.create({ data: { id: newId(), tenantId: tenant.id, userId, roleId } });
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        resourceType: 'user',
        resourceId: userId,
        action: 'create',
        details: { via: 'cli', role: roleCode },
      },
    });
  });

  // Ke stdout (bukan log aplikasi): satu-satunya tempat sandi sementara pernah terlihat.
  process.stdout.write(
    `${[
      `Akun dibuat di ${tenant.code} · ${tenant.name}`,
      `  Peran           : ${roleCode}`,
      `  Nama pengguna   : ${args.username}`,
      `  Sandi sementara : ${temporaryPassword}`,
      '',
      'Sandi sementara hanya ditampilkan sekali. Berikan langsung ke pemilik akun; saat login pertama ia wajib',
      'mendaftarkan aplikasi autentikator dan mengganti kata sandi.',
    ].join('\n')}\n`,
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await prisma.$disconnect();
}
