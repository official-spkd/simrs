import { Module } from '@nestjs/common';

/**
 * K09 · CPOE: katalog, order set, kirim order (Idempotency-Key), batal beralasan, resep.
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.4 tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class OrdersModule {}
