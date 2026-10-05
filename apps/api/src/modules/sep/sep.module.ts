import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { bpjsLookupClientProvider } from './bpjs-lookup';
import { SepController } from './sep.controller';
import { SepRepository } from './sep.repository';
import { SepService } from './sep.service';

/**
 * F06 · Penjaminan dan eligibilitas (rencana fase 2 potongan 5a):
 * - `/api/v1/sep`: cek kepesertaan dan rujukan VClaim secara sinkron (`@NoRequestTransaction()` + `LookupGateway`,
 *   konektor dari klien BPJS bersama `@simrs/shared/node`, batas 5 dtk → 503 `BPJS_UNAVAILABLE`, ADR-0025);
 * - SEP berversi dan beku setelah `issued`: baca, revisi (versi baru), kirim ulang, batal. Penerbitan/revisi/hapus
 *   SELALU lewat outbox (`bpjs.vclaim.sep.insert|update|delete`, worker `apps/worker/src/outbox/sep.ts`) yang
 *   memeriksa SEP yang sudah ada (histori) sebelum menerbitkan ulang;
 * - `SepService.createPending` dipakai registrasi (F03) di transaksinya.
 * SPRI dan rencana kontrol menyusul (potongan 7). Izin `coverage.read|write`.
 */
@Module({
  imports: [AuthzModule],
  controllers: [SepController],
  providers: [SepService, SepRepository, bpjsLookupClientProvider],
  exports: [SepService],
})
export class SepModule {}
