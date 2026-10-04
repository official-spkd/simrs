import { Module } from '@nestjs/common';

/**
 * F05 · Anjungan mandiri. KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`, potongan 6 cukup menambah
 * controller/service/repository di folder ini.
 *
 * TITIK SAMBUNG PRINSIPAL PERANGKAT (ADR-0027 di atas tabel `registered_devices` ADR-0024; jenis anjungan ditambah
 * dengan melebarkan CHECK `registered_devices_kind`): endpoint anjungan TIDAK memakai sesi staf. Penjaga perangkat
 * (mis. `DeviceGuard`) nanti menetapkan `req.tenantId` + pelaku perangkat dengan izin tetap `kiosk.use`; setelah itu
 * `TenantTransactionInterceptor`, `LookupGateway`, dan `SseService` dipakai apa adanya karena ketiganya hanya membaca
 * tenant + pelaku dari konteks permintaan. Jangan membuat tabel perangkat baru.
 *
 * Isi nanti (potongan 6):
 * - identify (nama tersamar + tanggal lahir tanpa tahun + rate limit per perangkat, keputusan §4 #3), check-in booking,
 *   registrasi mandiri, tiket, bantuan, cetak.
 */
@Module({})
export class KioskModule {}
