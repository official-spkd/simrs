import { Module } from '@nestjs/common';

/**
 * K12 · eMAR (pindai gelang, pemberian, cek ganda high-alert), asuhan keperawatan, balans cairan.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.5 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class NursingModule {}
