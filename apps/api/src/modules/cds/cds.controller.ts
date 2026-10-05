import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type CdsOverrideQuery, type CdsOverrideReport, cdsOverrideQuerySchema } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CdsReportService } from './cds-report.service';

/** K09 · CDS: laporan tinjauan override (`/api/v1/cds/overrides`, auditor mutu dan komite farmasi/PFT). */
@ApiTags('klinis · CDS')
@TenantScoped()
@RequireModule('K09')
@Controller('cds')
export class CdsController {
  constructor(private readonly report: CdsReportService) {}

  @RequirePermission('order', 'read')
  @Get('overrides')
  overrides(
    @Query(new ZodValidationPipe(cdsOverrideQuerySchema)) q: CdsOverrideQuery,
  ): Promise<CdsOverrideReport> {
    return this.report.overrides(q);
  }
}
