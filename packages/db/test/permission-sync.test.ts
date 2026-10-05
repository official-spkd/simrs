/**
 * P03 · Sinkron izin katalog ke peran RS yang sudah berjalan (`syncRolePermissions`, `pnpm db:sync-permissions`).
 * Katalog "versi berikutnya" ditiru dengan katalog sintetis; setiap tes memakai RS fiktif baru.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { newId, PERMISSION_CATALOG_RECORD_KEY, type PermissionScope } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CODE_PERMISSION_CATALOG,
  createPrismaClient,
  ensureSystemRoles,
  type PermissionSyncCatalog,
  type PrismaClient,
  syncRolePermissions,
  type TenantTx,
  withTenant,
} from '../src/index';
import { SEED_PLATFORM_TENANT, SEED_TENANTS } from '../src/seed-data';
import { testDbUrls } from '../src/testing';

let owner: PrismaClient;

beforeAll(() => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await owner.$disconnect();
});

/** Sumber fiktif "baru" (format kolom: huruf kecil, titik, garis bawah). */
const NEW = 'uji.fiturbaru';
type Grant = readonly [string, string, PermissionScope];

/** Katalog berikutnya: izin `uji.fiturbaru.*` baru, bawaannya untuk perawat/dokter (+ izin tambahan). */
function nextCatalog(extra: Record<string, Grant[]> = {}, extraKeys: string[] = []): PermissionSyncCatalog {
  const grants: Record<string, Grant[]> = {
    perawat: [[NEW, 'read', 'relationship']],
    dokter: [
      [NEW, 'read', 'relationship'],
      [NEW, 'write', 'relationship'],
    ],
  };
  for (const [role, g] of Object.entries(extra)) grants[role] = [...(grants[role] ?? []), ...g];
  return {
    keys: [...CODE_PERMISSION_CATALOG.keys, `${NEW}.read`, `${NEW}.write`, ...extraKeys].sort(),
    baseline: CODE_PERMISSION_CATALOG.baseline,
    rolesFor: (kind) =>
      CODE_PERMISSION_CATALOG.rolesFor(kind).map((r) => ({
        ...r,
        grants: [...r.grants, ...(grants[r.code] ?? [])],
      })),
  };
}

async function newTenant(): Promise<{ id: string; code: string }> {
  const id = newId();
  const code = `S${id
    .slice(-10)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')}`;
  await withTenant(owner, id, async (tx) => {
    await tx.tenant.create({ data: { id, code, name: 'RS Fiktif Uji Sinkron Izin' } });
    await ensureSystemRoles(tx, id);
  });
  return { id, code };
}

const inTenant = <T>(id: string, fn: (tx: TenantTx) => Promise<T>) => withTenant(owner, id, fn);

/** Izin katalog kode yang belum ada di baseline sinkron (mis. izin front office fase 2), urut katalog. */
const sinceBaseline = () =>
  CODE_PERMISSION_CATALOG.keys.filter((k) => !CODE_PERMISSION_CATALOG.baseline.includes(k));

const sync = (id: string, opts: Parameters<typeof syncRolePermissions>[3] = {}) =>
  inTenant(id, (tx) => syncRolePermissions(tx, id, 'hospital', opts));

/** Izin peran sebagai `sumber.aksi:lingkup`, urut. */
const grantsOf = (id: string, role: string) =>
  inTenant(id, async (tx) =>
    (
      await tx.rolePermission.findMany({
        where: { role: { code: role } },
        select: { resource: true, action: true, scope: true },
      })
    )
      .map((g) => `${g.resource}.${g.action}:${g.scope}`)
      .sort(),
  );

const recordOf = (id: string) =>
  inTenant(id, async (tx) => {
    const row = await tx.tenantSetting.findFirst({ where: { key: PERMISSION_CATALOG_RECORD_KEY } });
    return (row?.value as { permissions: string[] } | undefined)?.permissions ?? null;
  });

const auditCount = (id: string) => inTenant(id, (tx) => tx.auditEvent.count());

/** Tiru editor matriks (API): ubah baris + audit selisih dengan format yang sama. */
async function adminEdit(
  id: string,
  role: string,
  change: { add?: Grant[]; remove?: Grant[] },
): Promise<void> {
  await inTenant(id, async (tx) => {
    const r = await tx.role.findFirstOrThrow({ where: { code: role } });
    for (const [resource, action] of change.remove ?? []) {
      await tx.rolePermission.deleteMany({ where: { roleId: r.id, resource, action } });
    }
    for (const [resource, action, scope] of change.add ?? []) {
      await tx.rolePermission.create({ data: { tenantId: id, roleId: r.id, resource, action, scope } });
    }
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId: id,
        resourceType: 'role_permissions',
        resourceId: role,
        action: 'update',
        details: {
          added: (change.add ?? []).map(([res, act, sc]) => `${res}.${act}:${sc}`),
          removed: (change.remove ?? []).map(([res, act, sc]) => `${res}.${act}:${sc}`),
        },
      },
    });
  });
}

describe('sinkron izin katalog', () => {
  it('RS yang belum pernah disinkron: izin sesudah baseline dianggap baru, tetapi peran yang dibuat dari matriks bawaan saat ini sudah memegangnya → tidak ada tambahan; catatan ditulis sekali', async () => {
    const T = await newTenant();
    const before = await grantsOf(T.id, 'perawat');
    const r1 = await sync(T.id);
    expect(r1).toMatchObject({
      knownFrom: 'baseline',
      newPermissions: sinceBaseline(),
      added: [],
      recordChanged: true,
    });
    expect(r1.missingRoles).toEqual([]);
    expect(await recordOf(T.id)).toEqual(CODE_PERMISSION_CATALOG.keys);
    expect(await grantsOf(T.id, 'perawat')).toEqual(before);
    const audits = await auditCount(T.id);
    expect(audits).toBe(1);
    // Jalan ulang: tidak ada perubahan, tidak ada audit baru.
    const r2 = await sync(T.id);
    expect(r2).toMatchObject({ knownFrom: 'record', newPermissions: [], added: [], recordChanged: false });
    expect(await auditCount(T.id)).toBe(audits);
  });

  it('fase 2: peran RS lama menerima izin front office lewat sinkron dengan lingkup bawaan; izin perangkat tidak pernah', async () => {
    const T = await newTenant();
    const fresh = sinceBaseline();
    expect(fresh).toEqual(
      expect.arrayContaining(['queue.call', 'encounter.write', 'kiosk.use', 'queue.display.read']),
    );
    // Tiru RS yang perannya dibuat sebelum fase 2: baris izin baru belum pernah ada (bukan dicabut admin).
    await inTenant(T.id, async (tx) => {
      for (const key of fresh) {
        const dot = key.lastIndexOf('.');
        await tx.rolePermission.deleteMany({
          where: { resource: key.slice(0, dot), action: key.slice(dot + 1) },
        });
      }
    });

    const r = await sync(T.id);
    expect(r).toMatchObject({ knownFrom: 'baseline', newPermissions: fresh, skippedRemoved: [] });
    expect(
      r.added.filter((a) => a.permission === 'kiosk.use' || a.permission === 'queue.display.read'),
    ).toEqual([]);
    expect(await grantsOf(T.id, 'dokter')).toEqual(
      expect.arrayContaining(['queue.call:unit', 'encounter.read:relationship', 'schedule.read:all']),
    );
    // Setiap peran RS kembali tepat ke matriks bawaannya (izin front office dengan lingkup bawaan).
    for (const role of CODE_PERMISSION_CATALOG.rolesFor('hospital')) {
      expect(await grantsOf(T.id, role.code), role.code).toEqual(
        role.grants.map(([res, act, sc]) => `${res}.${act}:${sc}`).sort(),
      );
    }
  });

  it('izin baru masuk hanya ke peran yang memilikinya di matriks bawaan, dengan lingkup bawaan; diaudit; idempoten', async () => {
    const T = await newTenant();
    const other = await newTenant();
    await sync(T.id);
    const kasirBefore = await grantsOf(T.id, 'kasir');
    const otherBefore = await grantsOf(other.id, 'dokter');

    const r = await sync(T.id, { catalog: nextCatalog() });
    expect(r.knownFrom).toBe('record');
    expect(r.newPermissions).toEqual([`${NEW}.read`, `${NEW}.write`]);
    expect(r.added).toEqual([
      { role: 'perawat', permission: `${NEW}.read`, scope: 'relationship' },
      { role: 'dokter', permission: `${NEW}.read`, scope: 'relationship' },
      { role: 'dokter', permission: `${NEW}.write`, scope: 'relationship' },
    ]);
    expect(await grantsOf(T.id, 'perawat')).toContain(`${NEW}.read:relationship`);
    expect(await grantsOf(T.id, 'dokter')).toEqual(
      expect.arrayContaining([`${NEW}.read:relationship`, `${NEW}.write:relationship`]),
    );
    expect(await grantsOf(T.id, 'kasir')).toEqual(kasirBefore);
    expect(await recordOf(T.id)).toEqual(expect.arrayContaining([`${NEW}.read`, `${NEW}.write`]));

    const audit = await inTenant(T.id, (tx) =>
      tx.auditEvent.findMany({
        where: { resourceType: 'role_permissions', resourceId: 'dokter' },
        select: { action: true, actorRole: true, details: true },
      }),
    );
    expect(audit).toEqual([
      {
        action: 'update',
        actorRole: 'system',
        details: {
          added: [`${NEW}.read:relationship`, `${NEW}.write:relationship`],
          removed: [],
          via: 'catalog_sync',
        },
      },
    ]);

    // Idempoten + tenant lain tidak tersentuh.
    const audits = await auditCount(T.id);
    const again = await sync(T.id, { catalog: nextCatalog() });
    expect(again).toMatchObject({ newPermissions: [], added: [], recordChanged: false });
    expect(await auditCount(T.id)).toBe(audits);
    expect(await grantsOf(other.id, 'dokter')).toEqual(otherBefore);
    expect(await recordOf(other.id)).toBeNull();
  });

  it('izin yang dicabut admin setelah sinkron tidak pernah diberikan lagi; izin baru berikutnya tetap masuk', async () => {
    const T = await newTenant();
    await sync(T.id);
    await sync(T.id, { catalog: nextCatalog() });
    await adminEdit(T.id, 'dokter', { remove: [[NEW, 'write', 'relationship']] });

    const v3 = nextCatalog({ dokter: [[NEW, 'export', 'relationship']] }, [`${NEW}.export`]);
    const r = await sync(T.id, { catalog: v3 });
    expect(r.newPermissions).toEqual([`${NEW}.export`]);
    expect(r.added).toEqual([{ role: 'dokter', permission: `${NEW}.export`, scope: 'relationship' }]);
    const dokter = await grantsOf(T.id, 'dokter');
    expect(dokter).toContain(`${NEW}.export:relationship`);
    expect(dokter).not.toContain(`${NEW}.write:relationship`);
  });

  it('pencabutan admin SEBELUM sinkron pertama dikenali dari jejak audit', async () => {
    const T = await newTenant();
    // Kode baru sudah terpasang, admin sempat memberi lalu mencabut izin baru itu dari dokter lewat layar Akses.
    await adminEdit(T.id, 'dokter', { add: [[NEW, 'read', 'relationship']] });
    await adminEdit(T.id, 'dokter', { remove: [[NEW, 'read', 'relationship']] });

    const r = await sync(T.id, { catalog: nextCatalog() });
    expect(r.knownFrom).toBe('baseline');
    expect(r.skippedRemoved).toEqual([{ role: 'dokter', permission: `${NEW}.read` }]);
    expect(r.added).toEqual([
      { role: 'perawat', permission: `${NEW}.read`, scope: 'relationship' },
      { role: 'dokter', permission: `${NEW}.write`, scope: 'relationship' },
    ]);
    expect(await grantsOf(T.id, 'dokter')).not.toContain(`${NEW}.read:relationship`);
  });

  it('penyesuaian admin tidak disentuh: peran yang sudah memegang izin baru dengan lingkup lain dibiarkan', async () => {
    const T = await newTenant();
    await adminEdit(T.id, 'dokter', { add: [[NEW, 'read', 'all']] });
    const r = await sync(T.id, { catalog: nextCatalog() });
    expect(r.added.map((a) => `${a.role}:${a.permission}`)).toEqual([
      `perawat:${NEW}.read`,
      `dokter:${NEW}.write`,
    ]);
    const dokter = await grantsOf(T.id, 'dokter');
    expect(dokter).toContain(`${NEW}.read:all`);
    expect(dokter).not.toContain(`${NEW}.read:relationship`);
  });

  it('izin platform.* tidak pernah diberikan ke peran RS; tenant PLATFORM menerima izin platform barunya', async () => {
    const T = await newTenant();
    const catalog = nextCatalog({ admin_tenant: [['platform.rahasia', 'read', 'all']] }, [
      'platform.rahasia.read',
    ]);
    const r = await sync(T.id, { catalog });
    expect(r.newPermissions).toContain('platform.rahasia.read');
    expect(r.added.some((a) => a.permission.startsWith('platform.'))).toBe(false);
    expect((await grantsOf(T.id, 'admin_tenant')).some((g) => g.startsWith('platform.'))).toBe(false);

    // Tenant PLATFORM bersama: cukup uji coba (tanpa menulis).
    const P = SEED_PLATFORM_TENANT;
    const platformCatalog: PermissionSyncCatalog = {
      ...catalog,
      rolesFor: (kind) =>
        CODE_PERMISSION_CATALOG.rolesFor(kind).map((role) =>
          role.code === 'superadmin_platform'
            ? { ...role, grants: [...role.grants, ['platform.rahasia', 'read', 'all'] as const] }
            : role,
        ),
    };
    const p = await inTenant(P.id, (tx) =>
      syncRolePermissions(tx, P.id, 'platform', { catalog: platformCatalog, dryRun: true }),
    );
    expect(p.added).toEqual([
      { role: 'superadmin_platform', permission: 'platform.rahasia.read', scope: 'all' },
    ]);
  });

  it('uji coba (--dry-run) melaporkan rencana tanpa menyimpan apa pun', async () => {
    const T = await newTenant();
    await sync(T.id);
    const record = await recordOf(T.id);
    const dokter = await grantsOf(T.id, 'dokter');
    const audits = await auditCount(T.id);
    const r = await sync(T.id, { catalog: nextCatalog(), dryRun: true });
    expect(r).toMatchObject({ dryRun: true, recordChanged: true });
    expect(r.added).toHaveLength(3);
    expect(await recordOf(T.id)).toEqual(record);
    expect(await grantsOf(T.id, 'dokter')).toEqual(dokter);
    expect(await auditCount(T.id)).toBe(audits);
  });

  it('catatan katalog rusak → gagal keras (tidak diam-diam kembali ke baseline)', async () => {
    const T = await newTenant();
    await inTenant(T.id, (tx) =>
      tx.tenantSetting.create({
        data: { tenantId: T.id, key: PERMISSION_CATALOG_RECORD_KEY, value: { permissions: 'rusak' } },
      }),
    );
    try {
      await expect(sync(T.id, { catalog: nextCatalog() })).rejects.toThrow(/rusak/);
    } finally {
      // Jangan tinggalkan catatan rusak di database tes (CLI tanpa --tenant akan melaporkannya gagal).
      await inTenant(T.id, (tx) =>
        tx.tenantSetting.deleteMany({ where: { key: PERMISSION_CATALOG_RECORD_KEY } }),
      );
    }
  });
});

describe('persiapan database tes', () => {
  it('tenant seed ikut disinkron (izin baru di katalog sampai ke RSFA/RSFB lama tanpa membuat ulang DB)', async () => {
    for (const t of [...SEED_TENANTS, SEED_PLATFORM_TENANT]) {
      expect(await recordOf(t.id), t.code).toEqual(expect.arrayContaining([...CODE_PERMISSION_CATALOG.keys]));
    }
  });
});

describe('CLI pnpm db:sync-permissions', () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tsxCli = createRequire(resolve(packageRoot, 'package.json')).resolve('tsx/cli');
  // Tanpa --env-file: database tes dipaksa lewat env (jangan pernah menyentuh database pengembangan).
  const run = (args: string[]) =>
    promisify(execFile)(process.execPath, [tsxCli, 'scripts/sync-permissions.ts', ...args], {
      cwd: packageRoot,
      env: { ...process.env, MIGRATOR_DATABASE_URL: testDbUrls().migrator },
    });

  it('--dry-run tidak menyimpan; tanpa --dry-run menulis catatan; argumen salah → kode keluar 1', async () => {
    const T = await newTenant();
    const dry = await run(['--tenant', T.code, '--dry-run']);
    expect(dry.stdout).toContain(`${T.code} · RS Fiktif Uji Sinkron Izin`);
    expect(dry.stdout).toContain('catatan katalog akan diperbarui');
    expect(dry.stdout).toContain('Uji coba: tidak ada yang disimpan.');
    expect(await recordOf(T.id)).toBeNull();

    const real = await run(['--tenant', T.code.toLowerCase()]);
    expect(real.stdout).toContain('catatan katalog diperbarui');
    expect(await recordOf(T.id)).toEqual(CODE_PERMISSION_CATALOG.keys);
    const audit = await inTenant(T.id, (tx) =>
      tx.auditEvent.findFirst({ where: { resourceId: PERMISSION_CATALOG_RECORD_KEY } }),
    );
    expect(audit?.details).toMatchObject({ via: 'cli', knownFrom: 'baseline' });

    await expect(run(['--tenant', 'TIDAK-ADA-RS'])).rejects.toMatchObject({ code: 1 });
    await expect(run(['--hapus-semua'])).rejects.toMatchObject({ code: 1 });
  });
});
