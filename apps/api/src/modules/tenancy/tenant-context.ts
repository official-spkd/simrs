import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AppError, isUuid } from '@simrs/shared';
import type { Request } from 'express';
import { API_ENV, type ApiEnv } from '../../config/env';

export const TENANT_HEADER = 'x-tenant-id';

type TenantRequest = Request & { tenantId?: string };

/**
 * Menetapkan konteks tenant untuk permintaan.
 *
 * Fase 0 belum punya login (P02), sehingga tenant dibaca dari header `X-Tenant-Id`. Header itu bisa diisi
 * siapa saja, jadi cara ini HANYA diizinkan bila dev tools aktif (APP_ENV local/staging). Di produksi guard ini
 * menolak semua permintaan sampai P02 menyediakan tenant dari klaim token (header hanya boleh cocok dengan klaim,
 * selain itu `TENANT_MISMATCH`).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (!this.env.devTools) {
      throw new AppError('UNAUTHENTICATED', 'Autentikasi diperlukan', 401);
    }
    const raw = req.headers[TENANT_HEADER];
    if (typeof raw !== 'string' || !isUuid(raw)) {
      throw new AppError('TENANT_REQUIRED', 'Header X-Tenant-Id (UUID) wajib', 400);
    }
    req.tenantId = raw.toLowerCase();
    return true;
  }
}

/** Ambil tenant yang sudah ditetapkan `TenantGuard`. Melempar bila guard lupa dipasang. */
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<TenantRequest>().tenantId;
  if (!id) throw new AppError('TENANT_REQUIRED', 'Konteks tenant belum ditetapkan', 400);
  return id;
});
