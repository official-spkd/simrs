import { Module } from '@nestjs/common';

/**
 * K14 · Ringkasan pasien lintas kunjungan (kelompok rekam medis).
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.2a tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class SummaryModule {}
