import { SetMetadata } from '@nestjs/common';
import type { PermissionAction, PermissionResource } from '@simrs/shared';

export const REQUIRED_PERMISSION_KEY = 'simrs:required-permission';

export interface RequiredPermission {
  resource: PermissionResource;
  action: string;
}

/**
 * P03 · Endpoint hanya untuk peran yang punya izin `resource.action` (matriks per RS). Diperiksa oleh
 * `TenantTransactionInterceptor` SEBELUM handler; penolakan diaudit (`access_denied`) dan dibalas 403.
 * Lingkup izin (all | unit | relationship) tersedia untuk service lewat `TenantDb.permissionScope()`.
 */
export const RequirePermission = <R extends PermissionResource>(resource: R, action: PermissionAction<R>) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, { resource, action } satisfies RequiredPermission);
