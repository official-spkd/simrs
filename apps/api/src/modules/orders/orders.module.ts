import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CdsModule } from '../cds/cds.module';
import { DocumentsModule } from '../documents/documents.module';
import { OrderCatalogService } from './order-catalog.service';
import { EncounterOrdersController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersView } from './orders-view';

/**
 * K09 · CPOE: katalog, order set, pratinjau CDS, kirim order (Idempotency-Key), batal beralasan, resep PDF ber-TTE.
 * Didaftarkan sekali di `AppModule` (potongan 3.1); pola entri berversi, staging, dan ABAC dari `infra/clinical`
 * (global), evaluasi CDS dari modul `cds`.
 */
@Module({
  imports: [AuthzModule, CdsModule, DocumentsModule],
  controllers: [OrdersController, EncounterOrdersController],
  providers: [OrdersService, OrderCatalogService, OrdersView],
  exports: [OrdersView],
})
export class OrdersModule {}
