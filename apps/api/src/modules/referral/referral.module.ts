import { Module } from '@nestjs/common';

/**
 * F07 · Rujukan (masuk, keluar, internal antarpoli). KERANGKA (fase 2 potongan 1b): sudah terdaftar di `AppModule`,
 * potongan 7 cukup menambah controller/service/repository di folder ini. Kode mengikuti katalog docs/02
 * (keputusan §4 #14: F07 = Rujukan).
 *
 * Isi nanti (potongan 7):
 * - Tabel `referrals` (potongan 0b); rujukan keluar/internal dan surat rujukan. Validasi rujukan masuk lewat lookup
 *   VClaim sinkron (`LookupGateway`, ADR-0025) di modul `sep`.
 * - Izin `referral.read|write`.
 */
@Module({})
export class ReferralModule {}
