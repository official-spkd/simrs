import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { FormsModule } from '../forms/forms.module';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

/**
 * S10 · Diagnostik lain (rencana fase 4 §4.8, ADR-0120): laporan EKG/USG/echo/endoskopi/treadmill di
 * `diagnostic_reports` (isian P07 + lampiran + TTE). Didaftarkan sekali di `AppModule`.
 */
@Module({
  imports: [AuthzModule, FormsModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
})
export class DiagnosticsModule {}
