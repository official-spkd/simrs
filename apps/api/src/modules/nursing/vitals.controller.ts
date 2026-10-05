import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ClinicalEnteredInErrorInput,
  clinicalEnteredInErrorInputSchema,
  type VitalSignsInput,
  vitalSignsInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { VitalsService } from './vitals.service';

const uuid = new ParseUUIDPipe();

/**
 * K12 (observasi) · `/api/v1/encounter/:id/observations`: tanda vital + NEWS2 (dihitung server) per kunjungan.
 * Rute di bawah `encounter/` sesuai rencana §3.2a; isinya milik modul keperawatan (pemilik folder `encounter` adalah
 * potongan ADT/encounter).
 */
@ApiTags('klinis · observasi tanda vital (K12)')
@TenantScoped()
@RequireModule('K12')
@Controller('encounter')
export class VitalsController {
  constructor(private readonly vitals: VitalsService) {}

  @RequirePermission('clinical', 'write')
  @Post(':id/observations')
  record(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(vitalSignsInputSchema)) body: VitalSignsInput,
  ) {
    return this.vitals.record(id, body);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/observations')
  list(@Param('id', uuid) id: string) {
    return this.vitals.list(id);
  }

  @RequirePermission('clinical', 'correct')
  @Post(':id/observations/:observationId/entered-in-error')
  enteredInError(
    @Param('id', uuid) id: string,
    @Param('observationId', uuid) observationId: string,
    @Body(new ZodValidationPipe(clinicalEnteredInErrorInputSchema)) body: ClinicalEnteredInErrorInput,
  ) {
    return this.vitals.enteredInError(id, observationId, body.reason);
  }
}
