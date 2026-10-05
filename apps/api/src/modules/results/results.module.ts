import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

/**
 * K08 · Muara hasil penunjang: observasi + laporan diagnostik (potongan 3.2a, keputusan fase 3 no. 12). Didaftarkan
 * sekali di `AppModule` (potongan 3.1). `ResultsService` diekspor untuk ringkasan pasien (`summary`).
 */
@Module({
  imports: [AuthzModule],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
