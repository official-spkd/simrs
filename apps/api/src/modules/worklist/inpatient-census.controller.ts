import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type InpatientCensus, type InpatientCensusQuery, inpatientCensusQuerySchema } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { InpatientCensusService } from './inpatient-census.service';

/**
 * K04 · `GET /api/v1/inpatients?unitId=`: daftar pasien rawat inap per unit/bed untuk layar Rawat inap (W4), disaring
 * ABAC (lingkup unit tingkat bed, relasi tim perawatan, akses darurat) dan diaudit per pasien.
 */
@ApiTags('klinis · rawat inap (K04)')
@TenantScoped()
@RequireModule('K04')
@Controller('inpatients')
export class InpatientCensusController {
  constructor(private readonly census: InpatientCensusService) {}

  @RequirePermission('clinical', 'read')
  @Get()
  list(
    @Query(new ZodValidationPipe(inpatientCensusQuerySchema)) q: InpatientCensusQuery,
  ): Promise<InpatientCensus> {
    return this.census.census(q);
  }
}
