import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { RegistrationModule } from '../registration/registration.module';
import { ReferralController } from './referral.controller';
import { ReferralRepository } from './referral.repository';
import { ReferralService } from './referral.service';

/**
 * F07 · Rujukan + surat F06 (rencana fase 2 potongan 7; kode mengikuti katalog docs/02, keputusan §4 #14):
 * - `POST /referrals/control-letters` surat kontrol / SPRI, `POST /referrals/outgoing` rujukan keluar,
 *   `POST /referrals/internal` rujukan internal antarpoli, `GET /referrals[/:id]`, `POST /referrals/:id/cancel|retry`;
 * - kiriman VClaim lewat outbox (`bpjs.vclaim.rencanakontrol.insert|delete`, `spri.insert`, `rujukan.insert|delete`,
 *   worker `apps/worker/src/outbox/referral.ts`); rujukan masuk tetap lewat lookup sinkron modul `sep` (ADR-0025).
 * Izin `referral.read|write`; ABAC per pasien kunjungan asal.
 */
@Module({
  imports: [AuthzModule, RegistrationModule],
  controllers: [ReferralController],
  providers: [ReferralService, ReferralRepository],
})
export class ReferralModule {}
