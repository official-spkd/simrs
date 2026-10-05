import { Module } from '@nestjs/common';

/**
 * F05 · Anjungan mandiri. KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`, potongan 6 cukup menambah
 * controller/service/repository di folder ini.
 *
 * PRINSIPAL PERANGKAT (ADR-0027): endpoint anjungan TIDAK memakai sesi staf. Pasang `@DeviceScoped('kiosk.use')`
 * (`common/device-scoped.decorator.ts`); pelaku perangkat ada di `TenantDb.actor().devicePrincipal`, unitnya di
 * `actor().unitId`. `TenantTransactionInterceptor`, `LookupGateway`, dan `SseService` dipakai apa adanya.
 *
 * Isi nanti (potongan 6):
 * - identify (nama tersamar + tanggal lahir tanpa tahun + rate limit per perangkat, keputusan §4 #3), check-in booking,
 *   registrasi mandiri, tiket, bantuan, cetak.
 */
@Module({})
export class KioskModule {}
