import { Module } from '@nestjs/common';

/**
 * F08 · Layanan informasi pelanggan (gateway informasi publik). KERANGKA (fase 2 potongan 1b): sudah terdaftar di
 * `AppModule`, potongan 8 cukup menambah controller/service di folder ini. Kode mengikuti katalog docs/02
 * (keputusan §4 #14: F08 = Layanan informasi).
 *
 * Isi nanti (potongan 8):
 * - Endpoint publik TANPA PHI dan tanpa sesi: jadwal + sisa kuota, antrean berjalan, status booking (kode booking +
 *   tanggal lahir di body, bukan di URL).
 * - Rate limit ketat per IP; tenant dari host/subdomain (`resolveTenantByHost`), bukan dari header klien.
 */
@Module({})
export class PatientPortalGatewayModule {}
