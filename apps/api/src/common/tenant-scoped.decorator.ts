import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../infra/auth/auth.guard';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

/**
 * Wajib untuk setiap controller yang menyentuh data tenant:
 * 1. `AuthGuard` memvalidasi sesi login dan menetapkan tenant + pelaku (mode header hanya untuk pengembangan lokal),
 * 2. `TenantTransactionInterceptor` membuka satu transaksi ber-RLS + menulis audit sebelum commit.
 */
export const TenantScoped = () =>
  applyDecorators(ApiBearerAuth(), UseGuards(AuthGuard), UseInterceptors(TenantTransactionInterceptor));
