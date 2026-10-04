import { SetMetadata } from '@nestjs/common';

export const NO_REQUEST_TRANSACTION_KEY = 'simrs:no-request-transaction';

/**
 * Handler ini TIDAK dibungkus satu transaksi permintaan (ADR-0025, ADR-0026). Hanya untuk dua pola:
 * 1. lookup baca-saja ke sistem luar lewat `LookupGateway` (BPJS peserta/rujukan, Dukcapil demografi),
 * 2. aliran SSE lewat `SseService.stream()` yang bisa terbuka berjam-jam.
 *
 * Yang tetap berlaku (dikerjakan `TenantTransactionInterceptor` dalam transaksi pendek masing-masing):
 * `AuthGuard`, `@RequirePermission` (penolakan diaudit lalu 403), `@RequireModule`, dan `@Audited` (ditulis setelah
 * handler selesai). Akses data di dalam handler wajib lewat `TenantDb.transaction(fn)`; `TenantDb.tx()` di luar itu
 * adalah galat program. Penulisan ke sistem luar tetap lewat outbox (CLAUDE.md §4.5).
 *
 * Pasang di handler (bukan controller) bersama `@TenantScoped()` di controllernya.
 */
export const NoRequestTransaction = () => SetMetadata(NO_REQUEST_TRANSACTION_KEY, true);
