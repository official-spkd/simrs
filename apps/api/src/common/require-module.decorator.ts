import { SetMetadata } from '@nestjs/common';
import type { ComponentCode } from '@simrs/shared';

export const REQUIRED_MODULE_KEY = 'simrs:required-module';

/**
 * Endpoint hanya tersedia bila modul (kode komponen katalog) aktif untuk RS ini (P10, `tenant_modules`).
 * Diperiksa di dalam transaksi permintaan oleh `TenantTransactionInterceptor`; modul mati → 403 MODULE_DISABLED.
 * Pasang di controller atau handler.
 */
export const RequireModule = (code: ComponentCode) => SetMetadata(REQUIRED_MODULE_KEY, code);
