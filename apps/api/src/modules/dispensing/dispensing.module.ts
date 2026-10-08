import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency';
import { AuthzModule } from '../authz/authz.module';
import { OrdersModule } from '../orders/orders.module';
import { PharmacyClinicalModule } from '../pharmacy-clinical/pharmacy-clinical.module';
import { DispensingController } from './dispensing.controller';
import { DispensingService } from './dispensing.service';

/**
 * S05 · Dispensing (rencana fase 4 §4.6b): FEFO, cek ganda high alert, label dosis untuk eMAR, retur. Kerangka 4.1a,
 * isi potongan 4.6b. `DispensingService.resolveLabel` diekspor untuk eMAR (F3-5).
 */
@Module({
  imports: [AuthzModule, OrdersModule, PharmacyClinicalModule],
  controllers: [DispensingController],
  providers: [DispensingService, IdempotencyService],
  exports: [DispensingService],
})
export class DispensingModule {}
