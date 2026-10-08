import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency';
import { NumberingModule } from '../numbering/numbering.module';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/** S05 · Stok depo, B01 minimal (fase 4 potongan 4.6a). Dispensing (4.6b) memakai ledger yang sama. */
@Module({
  imports: [NumberingModule],
  controllers: [StockController],
  providers: [StockService, IdempotencyService],
  exports: [StockService],
})
export class StockModule {}
