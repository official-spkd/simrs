import {
  catalogPermissionKeys,
  defaultRolesFor,
  grantDiffEntry,
  newId,
  parseGrantDiffEntry,
  PERMISSION_CATALOG_BASELINE,
  PERMISSION_CATALOG_RECORD_KEY,
  permissionAllowedFor,
  permissionKey,
  type PermissionScope,
  type TenantKind,
} from '@simrs/shared';
import { lockTenantScope, ROLE_MATRIX_LOCK } from './authz';
import type { TenantTx } from './client';

/**
 * Katalog yang dipakai sinkron. Bawaan = katalog di kode (`@simrs/shared`); tes memakai katalog sintetis
 * untuk meniru versi berikutnya (izin baru) tanpa mengubah katalog sungguhan.
 */
export interface PermissionSyncCatalog {
  /** Semua kunci izin (`sumber.aksi`) di katalog. */
  keys: readonly string[];
  /** Izin yang dianggap sudah dikenal RS yang belum punya catatan katalog. */
  baseline: readonly string[];
  /** Peran bawaan + matriks bawaan per jenis tenant. */
  rolesFor: (
    kind: TenantKind,
  ) => ReadonlyArray<{ code: string; grants: ReadonlyArray<readonly [string, string, PermissionScope]> }>;
}

export const CODE_PERMISSION_CATALOG: PermissionSyncCatalog = {
  keys: catalogPermissionKeys(),
  baseline: PERMISSION_CATALOG_BASELINE,
  rolesFor: defaultRolesFor,
};

export interface PermissionSyncReport {
  tenantKind: TenantKind;
  /** Asal daftar izin yang sudah dikenal: catatan tersimpan, atau baseline (RS belum pernah disinkron). */
  knownFrom: 'record' | 'baseline';
  /** Izin katalog yang baru bagi RS ini (belum ada di catatan/baseline). */
  newPermissions: string[];
  /** Izin yang ditambahkan (atau akan ditambahkan pada uji coba) ke peran yang sudah ada. */
  added: Array<{ role: string; permission: string; scope: PermissionScope }>;
  /** Izin baru yang TIDAK diberikan karena jejak audit menunjukkan admin pernah mencabutnya dari peran itu. */
  skippedRemoved: Array<{ role: string; permission: string }>;
  /** Peran bawaan yang belum ada di RS ini; sinkron tidak membuat peran (itu tugas `ensureSystemRoles`). */
  missingRoles: string[];
  /** Catatan katalog berubah (ditulis kecuali uji coba). */
  recordChanged: boolean;
  dryRun: boolean;
}

interface CatalogRecord {
  v: 1;
  permissions: string[];
}

function parseRecord(value: unknown): CatalogRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const permissions = (value as { permissions?: unknown }).permissions;
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === 'string')) return null;
  return { v: 1, permissions };
}

/**
 * Izin yang pernah dicabut admin per peran, dari jejak audit perubahan matriks (`role_permissions`,
 * `details.removed` berformat `grantDiffEntry`). Jejak audit append-only, jadi pencabutan tidak bisa hilang.
 */
async function removedByRole(tx: TenantTx): Promise<Map<string, Set<string>>> {
  const events = await tx.auditEvent.findMany({
    where: { resourceType: 'role_permissions', resourceId: { not: null } },
    select: { resourceId: true, details: true },
  });
  const removed = new Map<string, Set<string>>();
  for (const e of events) {
    const list = (e.details as { removed?: unknown } | null)?.removed;
    if (!e.resourceId || !Array.isArray(list)) continue;
    for (const entry of list) {
      const parsed = typeof entry === 'string' ? parseGrantDiffEntry(entry) : null;
      if (!parsed) continue;
      const set = removed.get(e.resourceId) ?? new Set<string>();
      set.add(parsed.permission);
      removed.set(e.resourceId, set);
    }
  }
  return removed;
}

/**
 * P03 · Bawa izin yang BARU di katalog ke peran RS yang sudah berjalan (matriks bawaan hanya diisi saat peran
 * dibuat, ADR-0012). Aturan:
 * - "baru" = ada di katalog tetapi belum ada di catatan katalog RS (`PERMISSION_CATALOG_RECORD_KEY`); RS yang
 *   belum pernah disinkron memakai `PERMISSION_CATALOG_BASELINE`;
 * - izin baru hanya ditambahkan ke peran yang memilikinya di matriks bawaan, dengan lingkup bawaannya, dan
 *   hanya bila peran itu belum punya baris untuk sumber × aksi tersebut (penyesuaian admin tidak disentuh);
 * - tidak pernah mencabut apa pun; izin yang pernah dicabut admin dari peran itu (jejak audit) tidak
 *   diberikan lagi, juga bila pencabutan terjadi sebelum sinkron pertama;
 * - izin `platform.*` tidak pernah diberikan ke peran RS;
 * - setelah sinkron, catatan katalog = catatan lama ∪ katalog saat ini, sehingga izin yang kemudian dicabut
 *   admin tidak pernah dianggap baru lagi. Jalan ulang tanpa perubahan katalog = tanpa perubahan (idempoten).
 * Setiap penambahan diaudit per peran dengan format selisih yang sama dengan editor matriks (`via`), begitu
 * pula perubahan catatan katalog. Dipanggil dalam `withTenant`; dikunci per tenant bersama editor matriks.
 */
export async function syncRolePermissions(
  tx: TenantTx,
  tenantId: string,
  kind: TenantKind,
  opts: { dryRun?: boolean; catalog?: PermissionSyncCatalog; via?: string } = {},
): Promise<PermissionSyncReport> {
  const catalog = opts.catalog ?? CODE_PERMISSION_CATALOG;
  const dryRun = opts.dryRun ?? false;
  const via = opts.via ?? 'catalog_sync';
  if (!dryRun) await lockTenantScope(tx, ROLE_MATRIX_LOCK);

  const recordRow = await tx.tenantSetting.findFirst({
    where: { key: PERMISSION_CATALOG_RECORD_KEY },
    select: { value: true },
  });
  const record = recordRow ? parseRecord(recordRow.value) : null;
  // Catatan rusak tidak boleh diam-diam diganti baseline (izin yang sudah dicabut bisa dianggap baru lagi).
  if (recordRow && !record) throw new Error(`Catatan katalog izin (${PERMISSION_CATALOG_RECORD_KEY}) rusak`);
  const known = new Set(record?.permissions ?? catalog.baseline);
  const newPermissions = catalog.keys.filter((k) => !known.has(k));
  const isNew = new Set(newPermissions);

  const roles = await tx.role.findMany({
    select: { id: true, code: true, permissions: { select: { resource: true, action: true } } },
  });
  const byCode = new Map(roles.map((r) => [r.code, r] as const));
  const removed = newPermissions.length > 0 ? await removedByRole(tx) : new Map<string, Set<string>>();

  const report: PermissionSyncReport = {
    tenantKind: kind,
    knownFrom: record ? 'record' : 'baseline',
    newPermissions,
    added: [],
    skippedRemoved: [],
    missingRoles: [],
    recordChanged: false,
    dryRun,
  };
  const inserts: Array<{
    roleId: string;
    role: string;
    resource: string;
    action: string;
    scope: PermissionScope;
  }> = [];
  for (const def of catalog.rolesFor(kind)) {
    const role = byCode.get(def.code);
    if (!role) {
      report.missingRoles.push(def.code);
      continue;
    }
    const held = new Set(role.permissions.map((p) => permissionKey(p.resource, p.action)));
    for (const [resource, action, scope] of def.grants) {
      const permission = permissionKey(resource, action);
      if (!isNew.has(permission) || held.has(permission)) continue;
      if (!permissionAllowedFor(kind, resource)) continue;
      if (removed.get(role.code)?.has(permission)) {
        report.skippedRemoved.push({ role: role.code, permission });
        continue;
      }
      report.added.push({ role: role.code, permission, scope });
      inserts.push({ roleId: role.id, role: role.code, resource, action, scope });
    }
  }

  const nextKnown = [...new Set([...known, ...catalog.keys])].sort();
  report.recordChanged =
    !record ||
    record.permissions.length !== nextKnown.length ||
    nextKnown.some((k) => !record.permissions.includes(k));
  if (dryRun) return report;

  for (const role of new Set(inserts.map((i) => i.role))) {
    const rows = inserts.filter((i) => i.role === role);
    await tx.rolePermission.createMany({
      data: rows.map((r) => ({
        tenantId,
        roleId: r.roleId,
        resource: r.resource,
        action: r.action,
        scope: r.scope,
      })),
    });
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId,
        actorRole: 'system',
        resourceType: 'role_permissions',
        resourceId: role,
        action: 'update',
        details: { added: rows.map(grantDiffEntry).sort(), removed: [], via },
      },
    });
  }
  if (report.recordChanged) {
    const value = { v: 1, permissions: nextKnown } satisfies CatalogRecord;
    await tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: PERMISSION_CATALOG_RECORD_KEY } },
      create: { tenantId, key: PERMISSION_CATALOG_RECORD_KEY, value },
      update: { value, updatedBy: null },
    });
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId,
        actorRole: 'system',
        resourceType: 'tenant_setting',
        resourceId: PERMISSION_CATALOG_RECORD_KEY,
        action: 'update',
        details: { newPermissions, knownFrom: report.knownFrom, catalogSize: nextKnown.length, via },
      },
    });
  }
  return report;
}
