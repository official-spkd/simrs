import { Module } from '@nestjs/common';

/**
 * K02 · Konteks kunjungan klinis (banner pasien) dan mulai/selesai pelayanan klinis.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.2a tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class EncounterModule {}
