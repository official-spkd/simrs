import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { TenantGuard } from '../modules/tenancy/tenant-context';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

/**
 * Wajib untuk setiap controller yang menyentuh data tenant:
 * 1. `TenantGuard` menetapkan tenant (fase 0–1: header dev; mulai P02: token login),
 * 2. `TenantTransactionInterceptor` membuka satu transaksi ber-RLS + menulis audit sebelum commit.
 */
export const TenantScoped = () =>
  applyDecorators(
    ApiHeader({ name: 'X-Tenant-Id', required: false, description: 'Hanya non-produksi sampai login (P02)' }),
    UseGuards(TenantGuard),
    UseInterceptors(TenantTransactionInterceptor),
  );
