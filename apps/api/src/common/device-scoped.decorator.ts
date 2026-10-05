import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { DevicePermission } from '@simrs/shared';
import { DeviceGuard, RequireDevicePermission } from '../infra/auth/device.guard';
import { UserThrottlerGuard } from '../infra/rate-limit';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

/**
 * ADR-0027 · Endpoint untuk PERANGKAT terdaftar (anjungan `kiosk`, display TV `display`), padanan `@TenantScoped()`
 * untuk staf:
 * 1. `DeviceGuard`: hanya token prinsipal perangkat (`dv1`); token staf → 403. Bila `permission` diberikan, harus
 *    termasuk izin tetap jenis perangkat (penolakan diaudit),
 * 2. `UserThrottlerGuard`: batas laju per perangkat (pelacak = tenant + id perangkat),
 * 3. `TenantTransactionInterceptor`: transaksi ber-RLS + audit seperti biasa; `deviceId`/`deviceKind` masuk `details`.
 *
 * Jangan pasang `@RequirePermission` (matriks peran manusia) di endpoint perangkat; interceptor menolaknya.
 * Endpoint staf (`@TenantScoped()`) menolak token perangkat dengan 403 + audit.
 */
export const DeviceScoped = (permission?: DevicePermission) =>
  applyDecorators(
    ApiBearerAuth(),
    ...(permission ? [RequireDevicePermission(permission)] : []),
    UseGuards(DeviceGuard, UserThrottlerGuard),
    UseInterceptors(TenantTransactionInterceptor),
  );
