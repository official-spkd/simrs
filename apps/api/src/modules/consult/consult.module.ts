import { Module } from '@nestjs/common';

/**
 * K10 · Konsultasi/rawat bersama, ganti DPJP utama (relasi akses ikut).
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.8 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class ConsultModule {}
