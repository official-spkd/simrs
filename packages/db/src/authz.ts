import {
  defaultRolesFor,
  newId,
  permissionKey,
  type PermissionScope,
  SCOPE_RANK,
  type TenantKind,
} from '@simrs/shared';
import type { TenantTx } from './client';

/**
 * P03 · Pastikan peran bawaan ada untuk tenant ini: 16 peran RS, atau peran platform untuk tenant PLATFORM.
 * Matriks bawaan hanya diisi saat peran BARU dibuat, sehingga matriks yang sudah disesuaikan tidak pernah
 * ditimpa. Idempoten.
 */
export async function ensureSystemRoles(
  tx: TenantTx,
  tenantId: string,
  kind: TenantKind = 'hospital',
): Promise<Map<string, string>> {
  const existing = new Map(
    (await tx.role.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id] as const),
  );
  for (const role of defaultRolesFor(kind)) {
    if (existing.has(role.code)) continue;
    const id = newId();
    await tx.role.create({ data: { id, tenantId, code: role.code, name: role.name, isSystem: true } });
    await tx.rolePermission.createMany({
      data: role.grants.map(([resource, action, scope]) => ({
        tenantId,
        roleId: id,
        resource,
        action,
        scope,
      })),
    });
    existing.set(role.code, id);
  }
  return existing;
}

const validScope = (scope: string | undefined): PermissionScope | null =>
  scope && scope in SCOPE_RANK ? (scope as PermissionScope) : null;

/** Lingkup izin peran untuk sumber × aksi, atau null bila tidak berizin / peran nonaktif. */
export async function roleGrantScope(
  tx: TenantTx,
  roleCode: string,
  resource: string,
  action: string,
): Promise<PermissionScope | null> {
  const row = await tx.rolePermission.findFirst({
    where: { resource, action, role: { code: roleCode, active: true } },
    select: { scope: true },
  });
  return validScope(row?.scope);
}

/**
 * Seluruh izin satu peran (`sumber.aksi` → lingkup) dalam satu kueri; kosong bila peran tidak ada atau
 * nonaktif. Dipakai cache matriks API (satu baris cache per tenant × peran).
 */
export async function roleGrants(tx: TenantTx, roleCode: string): Promise<Map<string, PermissionScope>> {
  const rows = await tx.rolePermission.findMany({
    where: { role: { code: roleCode, active: true } },
    select: { resource: true, action: true, scope: true },
  });
  const grants = new Map<string, PermissionScope>();
  for (const r of rows) {
    const scope = validScope(r.scope);
    if (scope) grants.set(permissionKey(r.resource, r.action), scope);
  }
  return grants;
}

/** Penugasan aktif pengguna pada saat `at` (peran aktif). */
export function activeAssignments(tx: TenantTx, userId: string, at: Date = new Date()) {
  return tx.staffAssignment.findMany({
    where: {
      userId,
      validFrom: { lte: at },
      OR: [{ validUntil: null }, { validUntil: { gt: at } }],
      role: { active: true },
    },
    select: {
      id: true,
      unitId: true,
      validUntil: true,
      role: { select: { code: true, name: true } },
      unit: { select: { code: true, name: true } },
    },
    orderBy: { validFrom: 'asc' },
  });
}

/**
 * Kunci transaksi per tenant untuk aturan yang menghitung banyak baris (mis. "minimal satu admin aktif").
 * Tanpa kunci, dua transaksi paralel bisa sama-sama lolos pemeriksaan lalu sama-sama commit (write skew di
 * READ COMMITTED). Kunci lepas otomatis saat transaksi selesai.
 */
export async function lockTenantScope(tx: TenantTx, scope: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(app_current_tenant()::text || ':' || ${scope}, 0))`;
}
