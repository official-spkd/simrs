import { Module } from '@nestjs/common';

/**
 * K08 · Hasil penunjang (observasi, laporan) dan muara hasil fase 4.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.2a tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class ResultsModule {}
