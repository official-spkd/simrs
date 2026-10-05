import { Module } from '@nestjs/common';

/**
 * K06 · Asesmen lewat formulir P07 per kunjungan dan kelengkapan paket formulir (EP 6b/7a).
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.8 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class AssessmentModule {}
