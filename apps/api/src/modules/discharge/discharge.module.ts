import { Module } from '@nestjs/common';

/**
 * K13 · Resume medis + rekonsiliasi obat + TTE, gerbang tutup kunjungan.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.6 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class DischargeModule {}
