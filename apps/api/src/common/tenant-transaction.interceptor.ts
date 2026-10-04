import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isModuleEnabled } from '@simrs/db';
import { AppError, type ComponentCode, type PermissionScope } from '@simrs/shared';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { type AuditMeta, writeAudit } from '../infra/audit-writer';
import { PermissionMatrix } from '../infra/permission-matrix';
import { PrismaService } from '../infra/prisma.service';
import { AuditedDenial } from './audited-denial';
import { AUDITED_KEY, type AuditedOptions } from './audited.decorator';
import { DEV_ROLE, type RequestActor, requestContext, type TenantRequestContext } from './request-context';
import { REQUIRED_MODULE_KEY } from './require-module.decorator';
import { REQUIRED_PERMISSION_KEY, type RequiredPermission } from './require-permission.decorator';

type TenantRequest = Request & { tenantId?: string; actor?: RequestActor; id?: unknown };

const MAX_USER_AGENT = 300;

/**
 * Dua tahap per permintaan bertenant:
 * 1. Otorisasi (P03) sebelum transaksi permintaan: matriks dari cache (`PermissionMatrix`, meleset → satu
 *    kueri). Peran tanpa izin → audit `access_denied` DI-COMMIT di transaksi singkat tersendiri, lalu 403.
 * 2. Unit of work: satu transaksi ber-RLS membungkus pemeriksaan modul (P10), handler, dan penulisan audit
 *    sebelum commit. Galat di mana pun → seluruh perubahan dan audit batal, kecuali penolakan `AuditedDenial`
 *    (ABAC akses pasien) yang dicatat ulang sebagai `access_denied` di transaksi terpisah. Setelah commit,
 *    kait `TenantDb.afterCommit` dijalankan (mis. invalidasi cache matriks).
 * Konsekuensi: handler tidak boleh memanggil sistem eksternal (pakai outbox, CLAUDE.md §4.5).
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantTransactionInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly matrix: PermissionMatrix,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const tenantId = req.tenantId;
    if (!tenantId) {
      // AuthGuard selalu dipasang bersama interceptor ini (@TenantScoped); ini pengaman bila tidak.
      throw new Error('TenantTransactionInterceptor tanpa AuthGuard');
    }
    const targets = [ctx.getHandler(), ctx.getClass()];
    const audited = this.reflector.get<AuditedOptions | undefined>(AUDITED_KEY, ctx.getHandler());
    const requiredModule = this.reflector.getAllAndOverride<ComponentCode | undefined>(
      REQUIRED_MODULE_KEY,
      targets,
    );
    const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );
    const actor = req.actor ?? { userId: null, role: null, sessionId: null, unitId: null };
    const auditMeta: AuditMeta = {
      actorUserId: actor.userId,
      actorRole: actor.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent']?.slice(0, MAX_USER_AGENT) ?? null,
      requestId: typeof req.id === 'string' ? req.id : null,
    };

    const run = async () => {
      const permissionScope = requiredPermission
        ? await this.authorize(tenantId, actor, requiredPermission, auditMeta)
        : null;
      const afterCommit: TenantRequestContext['afterCommit'] = [];

      const result = await this.prisma
        .forTenant(tenantId, (tx) => {
          const store: TenantRequestContext = {
            tenantId,
            tx,
            actor,
            requestId: auditMeta.requestId,
            ip: auditMeta.ip,
            userAgent: auditMeta.userAgent,
            permissionScope,
            audit: [],
            afterCommit,
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
                reason: audited.reason?.(src) ?? null,
              });
            }
            await writeAudit(tx, tenantId, auditMeta, store.audit);
            return result;
          });
        })
        .catch(async (err: unknown) => {
          // Transaksi permintaan sudah batal; penolakan ABAC tetap dicatat di transaksi tersendiri.
          if (err instanceof AuditedDenial) {
            await this.prisma.forTenant(tenantId, (tx) =>
              writeAudit(tx, tenantId, auditMeta, [
                { ...err.entry, action: 'access_denied', outcome: 'denied' },
              ]),
            );
          }
          throw err;
        });
      for (const fn of afterCommit) {
        try {
          await fn();
        } catch (err) {
          // Transaksi sudah commit: respons tetap sukses. Tanpa PHI di log (hanya jenis galat).
          this.logger.error(`Kait setelah commit gagal: ${err instanceof Error ? err.name : typeof err}`);
        }
      }
      return result;
    };
    return from(run());
  }

  /** Lingkup izin peran aktif, atau 403 (dengan audit penolakan yang pasti tersimpan). */
  private async authorize(
    tenantId: string,
    actor: RequestActor,
    required: RequiredPermission,
    auditMeta: AuditMeta,
  ): Promise<PermissionScope> {
    if (actor.role === DEV_ROLE) return 'all';
    const scope = actor.role
      ? await this.matrix.scope(tenantId, actor.role, required.resource, required.action)
      : null;
    if (!scope) {
      await this.prisma.forTenant(tenantId, (tx) =>
        writeAudit(tx, tenantId, auditMeta, [
          {
            action: 'access_denied',
            resourceType: required.resource,
            outcome: 'denied',
            details: { action: required.action, role: actor.role },
          },
        ]),
      );
      throw new AppError(
        'FORBIDDEN',
        actor.role ? 'Peran Anda tidak berizin untuk aksi ini' : 'Pilih unit kerja dan peran terlebih dahulu',
        403,
      );
    }
    return scope;
  }
}
