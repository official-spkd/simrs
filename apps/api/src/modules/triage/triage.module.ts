import { Module } from '@nestjs/common';

/**
 * K03 · Triase IGD (saran ATS server, turun wajib alasan), papan IGD, status alur IGD.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.3 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class TriageModule {}
