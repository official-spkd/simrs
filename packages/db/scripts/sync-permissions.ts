/**
 * P03 · Sinkron izin katalog ke peran RS yang sudah berjalan (ADR-0012: matriks bawaan hanya untuk peran baru).
 *
 *   pnpm db:sync-permissions --dry-run            # semua tenant aktif, tampilkan rencana saja
 *   pnpm db:sync-permissions                      # semua tenant aktif
 *   pnpm db:sync-permissions --tenant RSFA        # satu tenant
 *
 * Hanya MENAMBAH izin yang baru di katalog ke peran yang memilikinya di matriks bawaan; tidak pernah mencabut,
 * tidak menyentuh izin yang sudah disesuaikan admin, dan tidak memberi lagi izin yang pernah dicabut admin
 * (lihat `syncRolePermissions`). Satu transaksi per tenant; setiap perubahan tercatat di jejak audit.
 * Dijalankan operator dengan role migrator, tetap lewat withTenant karena FORCE RLS. API yang sedang berjalan
 * memakai izin baru paling lambat setelah TTL cache matriks (`AUTHZ_CACHE_TTL_SECONDS`).
 */
import { parseArgs } from 'node:util';
import { createPrismaClient, withTenant } from '../src/client';
import { type PermissionSyncReport, syncRolePermissions } from '../src/permission-sync';

const USAGE = 'Contoh: pnpm db:sync-permissions [--tenant RSFA] [--dry-run]';

function fail(message: string): never {
  console.error(`Gagal: ${message}`);
  process.exit(1);
}

const { values } = (() => {
  try {
    return parseArgs({
      options: { tenant: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
      strict: true,
    });
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
})();
const tenantCode = values.tenant?.trim().toUpperCase();
if (tenantCode !== undefined && !/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(tenantCode)) {
  fail(`--tenant wajib berisi kode tenant yang valid\n${USAGE}`);
}
const dryRun = values['dry-run'] ?? false;

const url = process.env.MIGRATOR_DATABASE_URL;
if (!url) fail('MIGRATOR_DATABASE_URL belum disetel (lihat .env.example)');

function describe(t: { code: string; name: string }, r: PermissionSyncReport): string[] {
  const lines = [`${t.code} · ${t.name} (${r.tenantKind === 'platform' ? 'platform' : 'RS'})`];
  lines.push(
    `  izin dikenal dari ${r.knownFrom === 'record' ? 'catatan katalog' : 'baseline (belum pernah disinkron)'}`,
  );
  lines.push(`  izin baru di katalog: ${r.newPermissions.length > 0 ? r.newPermissions.join(', ') : '-'}`);
  for (const a of r.added) lines.push(`  + ${a.role}: ${a.permission} (${a.scope})`);
  for (const s of r.skippedRemoved)
    lines.push(`  = ${s.role}: ${s.permission} (dilewati, pernah dicabut admin)`);
  if (r.missingRoles.length > 0) {
    const roles = r.missingRoles.length > 5 ? `${r.missingRoles.length} peran` : r.missingRoles.join(', ');
    lines.push(`  peran bawaan belum ada (tidak dibuat sinkron; lihat ensureSystemRoles): ${roles}`);
  }
  if (r.added.length === 0) lines.push('  tidak ada izin yang perlu ditambahkan');
  if (r.recordChanged) lines.push(`  catatan katalog ${dryRun ? 'akan diperbarui' : 'diperbarui'}`);
  return lines;
}

const prisma = createPrismaClient({ connectionString: url, max: 1 });
try {
  // `tenants` adalah registri tanpa FORCE RLS: pemilik tabel boleh membacanya tanpa konteks tenant.
  const tenants = await prisma.tenant.findMany({
    where: tenantCode ? { code: tenantCode } : { status: 'active' },
    select: { id: true, code: true, name: true, kind: true, status: true },
    orderBy: { code: 'asc' },
  });
  if (tenantCode) {
    const [t] = tenants;
    if (!t) fail(`tenant ${tenantCode} tidak ditemukan`);
    if (t.status !== 'active') fail(`tenant ${t.code} tidak aktif`);
  }
  if (tenants.length === 0) fail('tidak ada tenant aktif');

  let added = 0;
  const failed: string[] = [];
  // Satu transaksi per tenant: kegagalan satu RS dilaporkan tanpa membatalkan RS lain.
  for (const t of tenants) {
    const kind = t.kind === 'platform' ? 'platform' : 'hospital';
    try {
      const report = await withTenant(prisma, t.id, (tx) =>
        syncRolePermissions(tx, t.id, kind, { dryRun, via: 'cli' }),
      );
      added += report.added.length;
      process.stdout.write(`${describe(t, report).join('\n')}\n`);
    } catch (err) {
      failed.push(t.code);
      console.error(`${t.code} · gagal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.stdout.write(
    `${dryRun ? 'Uji coba: tidak ada yang disimpan. ' : ''}${tenants.length} tenant, ${added} izin ${
      dryRun ? 'akan ditambahkan' : 'ditambahkan'
    }.\n`,
  );
  if (failed.length > 0) fail(`${failed.length} tenant gagal disinkron: ${failed.join(', ')}`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await prisma.$disconnect();
}
