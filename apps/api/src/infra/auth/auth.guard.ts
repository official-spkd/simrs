import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, isUuid } from '@simrs/shared';
import type { Request } from 'express';
import type { RequestActor } from '../../common/request-context';
import { API_ENV, type ApiEnv } from '../../config/env';
import { PrismaService } from '../prisma.service';
import { ALLOW_INCOMPLETE_SESSION_KEY } from './allow-incomplete-session.decorator';
import { SessionStore } from './session-store';
import { bearerToken, parseToken } from './session-tokens';

export const TENANT_HEADER = 'x-tenant-id';

export type AuthenticatedRequest = Request & { tenantId?: string; actor?: RequestActor };

const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir', 401);

/**
 * Menetapkan tenant dan pelaku untuk permintaan (dipasang lewat `@TenantScoped()`).
 * 1. `Authorization: Bearer sa1.…` → sesi divalidasi di database (aktif, belum kedaluwarsa, tidak idle, akun aktif).
 *    Tenant berasal dari sesi; header X-Tenant-Id yang berbeda → 403 TENANT_MISMATCH.
 *    Sesi tanpa MFA atau wajib ganti kata sandi hanya boleh ke endpoint `@AllowIncompleteSession()`.
 * 2. Tanpa token: hanya bila mode header pengembang aktif (APP_ENV=local + ALLOW_DEV_TENANT_HEADER=true).
 * 3. Selain itu → 401.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionStore,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers[TENANT_HEADER];
    const token = bearerToken(req.headers.authorization);

    if (token) {
      const parsed = parseToken(token, 'sa1');
      if (!parsed) throw unauthenticated();
      if (typeof header === 'string' && header.toLowerCase() !== parsed.tenantId) {
        throw new AppError('TENANT_MISMATCH', 'Tenant permintaan tidak sesuai sesi', 403);
      }
      const session = await this.prisma.forTenant(parsed.tenantId, (tx) =>
        this.sessions.validateAccess(tx, parsed),
      );
      if (!session) throw unauthenticated();
      const allowIncomplete = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_INCOMPLETE_SESSION_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );
      if (!allowIncomplete && !session.mfaVerified) {
        throw new AppError('MFA_REQUIRED', 'Verifikasi dua langkah wajib sebelum mengakses data', 403);
      }
      if (!allowIncomplete && session.mustChangePassword) {
        throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Ganti kata sandi sementara terlebih dahulu', 403);
      }
      req.tenantId = parsed.tenantId;
      req.actor = {
        userId: session.userId,
        role: null,
        sessionId: session.sessionId,
        unitId: session.unitId,
      };
      return true;
    }

    if (this.env.devTenantHeader) {
      if (typeof header !== 'string' || !isUuid(header)) {
        throw new AppError('TENANT_REQUIRED', 'Header X-Tenant-Id (UUID) wajib', 400);
      }
      req.tenantId = header.toLowerCase();
      req.actor = { userId: null, role: 'dev', sessionId: null, unitId: null };
      return true;
    }

    throw new AppError('UNAUTHENTICATED', 'Autentikasi diperlukan', 401);
  }
}
