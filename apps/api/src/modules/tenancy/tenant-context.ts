import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError, isUuid } from '@simrs/shared';
import type { Request } from 'express';

export const TENANT_HEADER = 'x-tenant-id';

type TenantRequest = Request & { tenantId?: string };

/**
 * Fase 0: tenant diambil dari header `X-Tenant-Id`. Mulai fase 1 (P02) tenant berasal dari klaim token login,
 * dan header ini hanya boleh dipakai bila cocok dengan klaim (TENANT_MISMATCH bila berbeda).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const raw = req.headers[TENANT_HEADER];
    if (typeof raw !== 'string' || !isUuid(raw)) {
      throw new AppError('TENANT_REQUIRED', 'Header X-Tenant-Id (UUID) wajib', 400);
    }
    req.tenantId = raw.toLowerCase();
    return true;
  }
}

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<TenantRequest>().tenantId;
  if (!id) throw new AppError('TENANT_REQUIRED', 'Konteks tenant belum ditetapkan', 400);
  return id;
});
