import { Module } from '@nestjs/common';
import { CdsModule } from '../cds/cds.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NumberingModule } from '../numbering/numbering.module';
import { OrdersModule } from '../orders/orders.module';
import { PharmacyClinicalController } from './pharmacy-clinical.controller';
import { PharmacyClinicalService } from './pharmacy-clinical.service';

/**
 * S04 · Farmasi klinis (rencana fase 4 §4.5): telaah 3 aspek, CDS saat telaah, intervensi apoteker. Kerangka 4.1a,
 * isi potongan 4.5. Dispensing (4.6b) memakai `PharmacyClinicalService` untuk resep berstatus `penyiapan`.
 */
@Module({
  imports: [CdsModule, NotificationsModule, NumberingModule, OrdersModule],
  controllers: [PharmacyClinicalController],
  providers: [PharmacyClinicalService],
  exports: [PharmacyClinicalService],
})
export class PharmacyClinicalModule {}
