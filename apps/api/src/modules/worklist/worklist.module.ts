import { Module } from '@nestjs/common';

/**
 * K01 · Worklist DPJP/unit/shift/tugas (co-sign, verifikasi, tinjau order residen, TTE gagal, EWS tinggi, resume lewat batas).
 * Kerangka didaftarkan sekali di `AppModule` (potongan 3.1); isinya dibangun potongan 3.2b tanpa mengubah daftar
 * modul lagi. Pola entri berversi, staging, dan ABAC dari `infra/clinical` (global).
 */
@Module({})
export class WorklistModule {}
