import { Module } from '@nestjs/common';
import { CdsReportService } from './cds-report.service';
import { CdsController } from './cds.controller';
import { CdsService } from './cds.service';

/**
 * K09 · CDS (ADR-0030): evaluasi server dengan basis pengetahuan per RS (`CdsService`, dipakai modul `orders` untuk
 * pratinjau dan kirim order) dan laporan tinjauan override. Didaftarkan sekali di `AppModule` (potongan 3.1).
 */
@Module({
  controllers: [CdsController],
  providers: [CdsService, CdsReportService],
  exports: [CdsService],
})
export class CdsModule {}
