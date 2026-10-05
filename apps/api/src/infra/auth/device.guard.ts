import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, type DevicePermission } from '@simrs/shared';
import type { Request } from 'express';
import { type AuditMeta, writeAudit } from '../audit-writer';
import { PrismaService } from '../prisma.service';
import type { AuthenticatedRequest } from './auth.guard';
import { type AuthenticatedDevice, DevicePrincipals, deviceToken } from './device-principals';

export const DEVICE_PERMISSION_KEY = 'simrs:device-permission';

/** Izin tetap yang dibutuhkan endpoint perangkat (dipasang `@DeviceScoped(izin)`). */
export const RequireDevicePermission = (permission: DevicePermission) =>
  SetMetadata(DEVICE_PERMISSION_KEY, permission);

const MAX_USER_AGENT = 300;

/** Metadata audit untuk pelaku perangkat (tanpa pengguna/peran; id + jenis perangkat masuk `details`). */
export function deviceAuditMeta(req: Request & { id?: unknown }, device: AuthenticatedDevice): AuditMeta {
  return {
    actorUserId: null,
    actorRole: null,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, MAX_USER_AGENT) ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
    device: { id: device.id, kind: device.kind },
  };
}

/**
 * ADR-0027 · Penjaga endpoint perangkat (`@DeviceScoped()`): hanya token prinsipal perangkat `dv1` yang sah. Token
 * staf (sesi, PIN) dan mode header pengembang DITOLAK di sini, sehingga endpoint perangkat tidak pernah melihat izin
 * manusia. Izin yang dibutuhkan endpoint harus termasuk izin tetap jenis perangkat; penolakan diaudit (di-commit)
 * lalu 403. Menetapkan tenant + pelaku perangkat untuk `TenantTransactionInterceptor`.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    private readonly devices: DevicePrincipals,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest & { id?: unknown }>();
    const token = deviceToken(req.headers.authorization);
    if (!token) {
      if (req.headers.authorization) {
        throw new AppError(
          'FORBIDDEN',
          'Endpoint ini hanya untuk perangkat terdaftar (anjungan/display)',
          403,
        );
      }
      throw new AppError(
        'UNAUTHENTICATED',
        'Perangkat belum terdaftar atau kredensialnya tidak berlaku',
        401,
      );
    }
    const device = await this.devices.authenticate(token);
    if (!device) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Perangkat belum terdaftar atau kredensialnya tidak berlaku',
        401,
      );
    }
    const required = this.reflector.getAllAndOverride<DevicePermission | undefined>(DEVICE_PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && !device.permissions.includes(required)) {
      await this.prisma.forTenant(device.tenantId, (tx) =>
        writeAudit(tx, device.tenantId, deviceAuditMeta(req, device), [
          {
            action: 'access_denied',
            resourceType: 'device_endpoint',
            outcome: 'denied',
            details: { permission: required },
          },
        ]),
      );
      throw new AppError('FORBIDDEN', 'Perangkat ini tidak berizin untuk layar tersebut', 403);
    }
    req.tenantId = device.tenantId;
    req.actor = {
      userId: null,
      role: null,
      sessionId: null,
      unitId: device.unitId,
      devicePrincipal: { id: device.id, kind: device.kind, permissions: device.permissions },
    };
    return true;
  }
}
