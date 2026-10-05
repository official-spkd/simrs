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

// ---------------------------------------------------------------------------------------------------------------
// Rekonsiliasi matriks bawaan (`pnpm db:sync-permissions --reconcile`)
// ---------------------------------------------------------------------------------------------------------------

/** Selisih satu peran terhadap matriks bawaan, entri `sumber.aksi:lingkup` seperti audit editor matriks. */
export interface RoleGrantDiff {
  role: string;
  /** Izin bawaan yang belum dipegang peran (dengan lingkup bawaan). */
  added: string[];
  /** Izin yang dipegang peran tetapi tidak ada di matriks bawaan. */
  removed: string[];
  /** Izin yang dipegang dengan lingkup berbeda dari bawaan. */
  rescoped: Array<{ permission: string; from: PermissionScope; to: PermissionScope }>;
}

export interface PermissionReconcileReport {
  tenantKind: TenantKind;
  /** Peran sistem yang belum pernah diubah RS: disesuaikan ke matriks bawaan (pada uji coba: akan disesuaikan). */
  applied: RoleGrantDiff[];
  /** Peran sistem yang pernah diubah RS: selisihnya hanya dilaporkan untuk ditinjau admin, tidak disentuh. */
  review: RoleGrantDiff[];
  /** Peran bawaan yang belum ada di RS ini (tidak dibuat; lihat `ensureSystemRoles`). */
  missingRoles: string[];
  dryRun: boolean;
}

/**
 * Peran yang matriksnya pernah diubah RS: ada jejak audit `role_permissions` peran itu yang BUKAN tulisan sistem
 * (sinkron dan rekonsiliasi menulis `actor_role = 'system'`) dan benar-benar mengubah isi (selisih tidak kosong).
 * Jejak audit append-only, jadi peran yang pernah diubah tidak bisa kembali dianggap "belum diubah".
 */
async function customizedRoles(tx: TenantTx): Promise<Set<string>> {
  const events = await tx.auditEvent.findMany({
    where: { resourceType: 'role_permissions', resourceId: { not: null } },
    select: { resourceId: true, actorRole: true, details: true },
  });
  const out = new Set<string>();
  for (const e of events) {
    if (!e.resourceId || e.actorRole === 'system') continue;
    const d = (e.details ?? {}) as { added?: unknown; removed?: unknown };
    const changed =
      (Array.isArray(d.added) && d.added.length > 0) || (Array.isArray(d.removed) && d.removed.length > 0);
    if (changed) out.add(e.resourceId);
  }
  return out;
}

const isEmptyDiff = (d: RoleGrantDiff) => d.added.length + d.removed.length + d.rescoped.length === 0;

/**
 * P03 · Bawa PERUBAHAN matriks bawaan (izin baru, izin yang dicabut, lingkup yang berubah) ke peran sistem RS yang
 * sudah berjalan, tetapi HANYA peran yang belum pernah diubah RS (ADR-0012: matriks per RS milik RS):
 * - peran yang pernah diubah admin (`customizedRoles`) tidak disentuh; selisihnya dilaporkan per peran (`review`)
 *   untuk ditinjau di layar Akses;
 * - peran buatan RS (`is_system = false`) dan izin `platform.*` di tenant RS tidak pernah disentuh;
 * - setiap peran yang disesuaikan diaudit `system` dengan format selisih editor matriks (perubahan lingkup = lingkup
 *   lama keluar + lingkup baru masuk), sehingga peran itu tetap dianggap "belum diubah RS" pada rekonsiliasi
 *   berikutnya; jalan ulang tanpa perubahan bawaan = tanpa perubahan (idempoten);
 * - uji coba hanya menghitung, tidak menulis apa pun.
 * Dipanggil dalam `withTenant`; dikunci per tenant bersama editor matriks dan sinkron katalog.
 */
export async function reconcileRolePermissions(
  tx: TenantTx,
  tenantId: string,
  kind: TenantKind,
  opts: { dryRun?: boolean; catalog?: PermissionSyncCatalog; via?: string } = {},
): Promise<PermissionReconcileReport> {
  const catalog = opts.catalog ?? CODE_PERMISSION_CATALOG;
  const dryRun = opts.dryRun ?? false;
  const via = opts.via ?? 'matrix_reconcile';
  if (!dryRun) await lockTenantScope(tx, ROLE_MATRIX_LOCK);

  const roles = await tx.role.findMany({
    where: { isSystem: true },
    select: {
      id: true,
      code: true,
      permissions: { select: { resource: true, action: true, scope: true } },
    },
  });
  const byCode = new Map(roles.map((r) => [r.code, r] as const));
  const customized = await customizedRoles(tx);
  const report: PermissionReconcileReport = {
    tenantKind: kind,
    applied: [],
    review: [],
    missingRoles: [],
    dryRun,
  };

  for (const def of catalog.rolesFor(kind)) {
    const role = byCode.get(def.code);
    if (!role) {
      report.missingRoles.push(def.code);
      continue;
    }
    const wanted = new Map(
      def.grants
        .filter(([resource]) => permissionAllowedFor(kind, resource))
        .map(([resource, action, scope]) => [permissionKey(resource, action), { resource, action, scope }]),
    );
    const held = new Map(role.permissions.map((p) => [permissionKey(p.resource, p.action), p] as const));
    const diff: RoleGrantDiff = { role: role.code, added: [], removed: [], rescoped: [] };
    for (const [key, g] of wanted) {
      const h = held.get(key);
      if (!h) diff.added.push(grantDiffEntry(g));
      else if (h.scope !== g.scope) {
        diff.rescoped.push({ permission: key, from: h.scope as PermissionScope, to: g.scope });
      }
    }
    for (const [key, h] of held) {
      if (!wanted.has(key) && permissionAllowedFor(kind, h.resource)) diff.removed.push(grantDiffEntry(h));
    }
    diff.added.sort();
    diff.removed.sort();
    diff.rescoped.sort((a, b) => a.permission.localeCompare(b.permission));
    if (isEmptyDiff(diff)) continue;
    if (customized.has(role.code)) {
      report.review.push(diff);
      continue;
    }
    report.applied.push(diff);
    if (dryRun) continue;

    for (const p of role.permissions.filter((g) => diff.removed.includes(grantDiffEntry(g)))) {
      await tx.rolePermission.delete({
        where: { roleId_resource_action: { roleId: role.id, resource: p.resource, action: p.action } },
      });
    }
    for (const r of diff.rescoped) {
      const h = held.get(r.permission);
      if (!h) continue;
      await tx.rolePermission.update({
        where: { roleId_resource_action: { roleId: role.id, resource: h.resource, action: h.action } },
        data: { scope: r.to, updatedBy: null },
      });
    }
    const addRows = diff.added.map((entry) => {
      const parsed = parseGrantDiffEntry(entry);
      const g = parsed ? wanted.get(parsed.permission) : undefined;
      if (!g) throw new Error(`Entri izin bawaan tidak dikenali: ${entry}`);
      return { tenantId, roleId: role.id, resource: g.resource, action: g.action, scope: g.scope };
    });
    if (addRows.length > 0) await tx.rolePermission.createMany({ data: addRows });
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId,
        actorRole: 'system',
        resourceType: 'role_permissions',
        resourceId: role.code,
        action: 'update',
        details: {
          added: [...diff.added, ...diff.rescoped.map((r) => `${r.permission}:${r.to}`)].sort(),
          removed: [...diff.removed, ...diff.rescoped.map((r) => `${r.permission}:${r.from}`)].sort(),
          via,
        },
      },
    });
  }
  return report;
}
