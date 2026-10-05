import { Module } from '@nestjs/common';
import { PublicInfoController } from './public-info.controller';
import { PublicInfoService } from './public-info.service';

/**
 * F08 · Layanan informasi pelanggan (gateway informasi publik, rencana fase 2 potongan 8). Kode mengikuti katalog
 * docs/02 (keputusan §4 #14: F08 = Layanan informasi).
 *
 * Endpoint publik TANPA PHI dan tanpa sesi (`/api/v1/public/:tenantCode/…`): jadwal + sisa kuota, antrean berjalan,
 * status booking (kode booking + tanggal lahir di body). Dibatasi laju per IP; RS dari kode di path (resolver
 * `app_resolve_tenant_by_code`, hanya RS aktif dengan modul F08 aktif). Bacaan langsung dari tabel 0b
 * (`public-info.repository.ts`) sampai modul scheduling/queue/booking mengekspor service bacaan publik.
 * Ketersediaan bed dan tarif (katalog F08) menyusul setelah K05/U01.
 */
@Module({ controllers: [PublicInfoController], providers: [PublicInfoService] })
export class PatientPortalGatewayModule {}
