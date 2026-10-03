import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isModuleEnabled } from '@simrs/db';
import { AppError, type ComponentCode, newId } from '@simrs/shared';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { PrismaService } from '../infra/prisma.service';
import { AUDITED_KEY, type AuditedOptions } from './audited.decorator';
import { REQUIRED_MODULE_KEY } from './require-module.decorator';
import { type RequestActor, requestContext, type TenantRequestContext } from './request-context';

type TenantRequest = Request & { tenantId?: string; actor?: RequestActor; id?: unknown };

const MAX_USER_AGENT = 300;

/**
 * Unit of work per permintaan: satu transaksi bertenant (RLS) membungkus handler, lalu entri audit
 * ditulis di transaksi yang SAMA sebelum commit. Galat di mana pun → seluruh perubahan dan audit batal.
 * Konsekuensi: handler tidak boleh memanggil sistem eksternal (pakai outbox, CLAUDE.md §4.5).
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const tenantId = req.tenantId;
    if (!tenantId) {
      // TenantGuard selalu dipasang bersama interceptor ini (@TenantScoped); ini pengaman bila tidak.
      throw new Error('TenantTransactionInterceptor tanpa TenantGuard');
    }
    const audited = this.reflector.get<AuditedOptions | undefined>(AUDITED_KEY, ctx.getHandler());
    const requiredModule = this.reflector.getAllAndOverride<ComponentCode | undefined>(REQUIRED_MODULE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const run = this.prisma.forTenant(tenantId, (tx) => {
      const store: TenantRequestContext = {
        tenantId,
        tx,
        actor: req.actor ?? { userId: null, role: null },
        requestId: typeof req.id === 'string' ? req.id : null,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent']?.slice(0, MAX_USER_AGENT) ?? null,
        audit: [],
      };
      return requestContext.run(store, async () => {
        if (requiredModule && !(await isModuleEnabled(tx, requiredModule))) {
          throw new AppError('MODULE_DISABLED', `Modul ${requiredModule} tidak aktif untuk RS ini`, 403);
        }
        const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
        if (audited) {
          const src = { params: req.params, query: req.query, body: req.body as unknown, result };
          store.audit.unshift({
            action: audited.action,
            resourceType: audited.resource,
            resourceId: audited.resourceId?.(src) ?? null,
            patientId: audited.patientId?.(src) ?? null,
            details: audited.details?.(src),
          });
        }
        if (store.audit.length > 0) {
          await tx.auditEvent.createMany({
            data: store.audit.map((e) => ({
              id: newId(),
              tenantId,
              actorUserId: store.actor.userId,
              actorRole: store.actor.role,
              patientId: e.patientId ?? null,
              resourceType: e.resourceType,
              resourceId: e.resourceId ?? null,
              action: e.action,
              outcome: e.outcome ?? 'success',
              reason: e.reason ?? null,
              ip: store.ip,
              userAgent: store.userAgent,
              requestId: store.requestId,
              details: e.details === undefined ? undefined : (e.details as object),
            })),
          });
        }
        return result;
      });
    });
    return from(run);
  }
}
