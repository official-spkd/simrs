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
import { AUDITED_KEY, type AuditedOptions, type AuditSource } from './audited.decorator';
import { NO_REQUEST_TRANSACTION_KEY } from './no-request-transaction.decorator';
import {
  DEV_ROLE,
  type PendingAudit,
  type RequestActor,
  requestContext,
  runAfterCommitHooks,
  type TenantRequestContext,
} from './request-context';
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
 *
 * Pengecualian `@NoRequestTransaction()` (ADR-0025 lookup sinkron, ADR-0026 SSE): otorisasi dan cek modul tetap,
 * masing-masing di transaksi pendek, lalu handler berjalan TANPA transaksi (`tx: null` di konteks); handler membuka
 * transaksi pendek sendiri lewat `TenantDb.transaction()`. Audit `@Audited` ditulis di transaksi pendek setelahnya.
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
    const noTransaction =
      this.reflector.getAllAndOverride<boolean | undefined>(NO_REQUEST_TRANSACTION_KEY, targets) === true;
    const actor = req.actor ?? { userId: null, role: null, sessionId: null, unitId: null };
    const auditMeta: AuditMeta = {
      actorUserId: actor.userId,
      actorRole: actor.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent']?.slice(0, MAX_USER_AGENT) ?? null,
      requestId: typeof req.id === 'string' ? req.id : null,
      device: actor.devicePrincipal
        ? { id: actor.devicePrincipal.id, kind: actor.devicePrincipal.kind }
        : null,
    };
    if (actor.devicePrincipal && requiredPermission) {
      // Perangkat tidak pernah memakai matriks peran manusia (ADR-0027); endpoint seperti ini salah rakit.
      throw new AppError('FORBIDDEN', 'Endpoint ini tidak untuk perangkat terdaftar', 403);
    }
    const auditedEntry = (result: unknown): PendingAudit | null => {
      if (!audited) return null;
      const src: AuditSource = { params: req.params, query: req.query, body: req.body as unknown, result };
      return {
        action: audited.action,
        resourceType: audited.resource,
        resourceId: audited.resourceId?.(src) ?? null,
        patientId: audited.patientId?.(src) ?? null,
        details: audited.details?.(src),
        reason: audited.reason?.(src) ?? null,
      };
    };
    const handle = () => lastValueFrom(next.handle(), { defaultValue: undefined });

    if (noTransaction) {
      return from(
        this.runWithoutTransaction(
          tenantId,
          actor,
          auditMeta,
          requiredPermission,
          requiredModule,
          auditedEntry,
          handle,
        ),
      );
    }

    const run = async () => {
      const permissionScope = await this.scopeFor(tenantId, actor, requiredPermission, auditMeta);
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
            const result = await handle();
            const entry = auditedEntry(result);
            if (entry) store.audit.unshift(entry);
            await writeAudit(tx, tenantId, auditMeta, store.audit);
            return result;
          });
        })
        .catch((err: unknown) => this.recordDenial(err, tenantId, auditMeta));
      await this.runAfterCommit(afterCommit);
      return result;
    };
    return from(run());
  }

  /**
   * Jalur `@NoRequestTransaction()`: otorisasi (penolakan di-commit) → cek modul (transaksi pendek) → handler tanpa
   * transaksi. Handler membuka transaksi pendek sendiri lewat `TenantDb.transaction()`. `@Audited` dan entri
   * `TenantDb.audit()` di luar transaksi pendek ditulis setelah handler; kait `afterCommit` di luar transaksi pendek
   * dijalankan sesudahnya.
   */
  private async runWithoutTransaction(
    tenantId: string,
    actor: RequestActor,
    auditMeta: AuditMeta,
    requiredPermission: RequiredPermission | undefined,
    requiredModule: ComponentCode | undefined,
    auditedEntry: (result: unknown) => PendingAudit | null,
    handle: () => Promise<unknown>,
  ): Promise<unknown> {
    const permissionScope = await this.scopeFor(tenantId, actor, requiredPermission, auditMeta);
    if (requiredModule) {
      const enabled = await this.prisma.forTenant(tenantId, (tx) => isModuleEnabled(tx, requiredModule));
      if (!enabled) {
        throw new AppError('MODULE_DISABLED', `Modul ${requiredModule} tidak aktif untuk RS ini`, 403);
      }
    }
    const store: TenantRequestContext = {
      tenantId,
      tx: null,
      actor,
      requestId: auditMeta.requestId,
      ip: auditMeta.ip,
      userAgent: auditMeta.userAgent,
      permissionScope,
      audit: [],
      afterCommit: [],
    };
    let result: unknown;
    try {
      result = await requestContext.run(store, handle);
    } catch (err) {
      return this.recordDenial(err, tenantId, auditMeta);
    }
    const entry = auditedEntry(result);
    const entries = entry ? [entry, ...store.audit] : store.audit;
    if (entries.length > 0) {
      await this.prisma.forTenant(tenantId, (tx) => writeAudit(tx, tenantId, auditMeta, entries));
    }
    await this.runAfterCommit(store.afterCommit);
    return result;
  }

  /** Transaksi permintaan sudah batal; penolakan ABAC tetap dicatat di transaksi tersendiri, lalu galat diteruskan. */
  private async recordDenial(err: unknown, tenantId: string, auditMeta: AuditMeta): Promise<never> {
    if (err instanceof AuditedDenial) {
      await this.prisma.forTenant(tenantId, (tx) =>
        writeAudit(tx, tenantId, auditMeta, [{ ...err.entry, action: 'access_denied', outcome: 'denied' }]),
      );
    }
    throw err;
  }

  private runAfterCommit(hooks: TenantRequestContext['afterCommit']): Promise<void> {
    return runAfterCommitHooks(hooks, (m) => this.logger.error(m));
  }

  /**
   * Lingkup izin endpoint: perangkat (ADR-0027) selalu `unit` (izin tetapnya berlingkup unit perangkat, `DEVICE_GRANTS`;
   * izinnya sudah diperiksa `DeviceGuard`); manusia dari matriks peran bila endpoint ber-`@RequirePermission`.
   */
  private scopeFor(
    tenantId: string,
    actor: RequestActor,
    required: RequiredPermission | undefined,
    auditMeta: AuditMeta,
  ): Promise<PermissionScope | null> {
    if (actor.devicePrincipal) return Promise.resolve('unit');
    return required ? this.authorize(tenantId, actor, required, auditMeta) : Promise.resolve(null);
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
