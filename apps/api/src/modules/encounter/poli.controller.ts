import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { poliWorklistQuerySchema } from '@simrs/shared';
import type { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PoliService } from './poli.service';

/** K01/K02 · Antrean poli hari ini (layar Pemeriksaan poli mode api, W1). */
@ApiTags('klinis · pemeriksaan poli (K01/K02)')
@TenantScoped()
@RequireModule('K02')
@Controller('poli')
export class PoliController {
  constructor(private readonly poli: PoliService) {}

  @RequirePermission('clinical', 'read')
  @Get('worklist')
  worklist(
    @Query(new ZodValidationPipe(poliWorklistQuerySchema)) q: z.infer<typeof poliWorklistQuerySchema>,
  ) {
    return this.poli.worklist(q.serviceId);
  }
}

/** K02 · Kunjungan rawat jalan dalam bentuk layar poli (rute per kunjungan kanonik). */
@ApiTags('klinis · pemeriksaan poli (K01/K02)')
@TenantScoped()
@RequireModule('K02')
@Controller('encounters')
export class PoliVisitController {
  constructor(private readonly poli: PoliService) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/poli-visit')
  visit(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.poli.visit(id);
  }
}
