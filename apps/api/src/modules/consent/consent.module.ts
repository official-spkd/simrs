import { Module } from '@nestjs/common';

/**
 * K11 · Persetujuan/penolakan tindakan tablet + TTE.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.7 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class ConsentModule {}
