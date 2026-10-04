import { Module } from '@nestjs/common';

/**
 * F05 · Anjungan mandiri. KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`, potongan 6 cukup menambah
 * controller/service/repository di folder ini.
 *
 * TITIK SAMBUNG PRINSIPAL PERANGKAT (ADR-0027, menunggu tabel `registered_devices` dari cabang PIN 10c-2):
 * endpoint anjungan TIDAK memakai sesi staf. Penjaga perangkat (mis. `DeviceGuard`) nanti menetapkan `req.tenantId` +
 * pelaku perangkat dengan izin tetap `kiosk.use`; setelah itu `TenantTransactionInterceptor`, `LookupGateway`, dan
 * `SseService` dipakai apa adanya karena ketiganya hanya membaca tenant + pelaku dari konteks permintaan. Jangan
 * membuat tabel perangkat di sini.
 *
 * Isi nanti (potongan 6):
 * - identify (nama tersamar + tanggal lahir tanpa tahun + rate limit per perangkat, keputusan §4 #3), check-in booking,
 *   registrasi mandiri, tiket, bantuan, cetak.
 */
@Module({})
export class KioskModule {}
