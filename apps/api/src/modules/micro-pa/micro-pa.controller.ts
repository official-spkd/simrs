import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AntibiogramQuery,
  antibiogramQuerySchema,
  type MicroIsolateStageInput,
  microIsolateStageInputSchema,
  type MicroTechnicalInput,
  microTechnicalInputSchema,
  type PaReportCreateInput,
  paReportCreateInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MicroService } from './micro.service';
import { PaService } from './pa.service';

const uuid = new ParseUUIDPipe();

/**
 * S02 · `/api/v1/micro/*`: worklist kultur, isolat + uji kepekaan per tahap, validasi teknis (analis) → rilis klinis
 * ber-TTE (dokter lain), antibiogram kumulatif.
 */
@ApiTags('penunjang · mikrobiologi (S02)')
@TenantScoped()
@RequireModule('S02')
@Controller('micro')
export class MicroController {
  constructor(private readonly micro: MicroService) {}

  @RequirePermission('lab.worklist', 'read')
  @Get('worklist')
  worklist() {
    return this.micro.worklist();
  }

  @RequirePermission('lab.worklist', 'read')
  @Get('orders/:id')
  get(@Param('id', uuid) id: string) {
    return this.micro.get(id);
  }

  @RequirePermission('lab.result', 'write')
  @Post('isolates')
  addIsolate(@Body(new ZodValidationPipe(microIsolateStageInputSchema)) body: MicroIsolateStageInput) {
    return this.micro.addIsolate(body);
  }

  @RequirePermission('lab.result', 'verify')
  @Post('reports')
  technical(@Body(new ZodValidationPipe(microTechnicalInputSchema)) body: MicroTechnicalInput) {
    return this.micro.technical(body);
  }

  @RequirePermission('lab.result', 'release')
  @Post('reports/:id/release')
  release(@Param('id', uuid) id: string) {
    return this.micro.release(id);
  }

  @RequirePermission('lab.worklist', 'read')
  @Get('antibiogram')
  antibiogram(@Query(new ZodValidationPipe(antibiogramQuerySchema)) q: AntibiogramQuery) {
    return this.micro.antibiogram(q);
  }
}

/** S02 · `/api/v1/pa/reports`: laporan patologi anatomi berversi + TTE (dokter berpenugasan di unit Lab/PA). */
@ApiTags('penunjang · patologi anatomi (S02)')
@TenantScoped()
@RequireModule('S02')
@Controller('pa')
export class PaController {
  constructor(private readonly pa: PaService) {}

  @RequirePermission('lab.result', 'release')
  @Get('worklist')
  worklist() {
    return this.pa.worklist();
  }

  @RequirePermission('lab.result', 'release')
  @Get('reports')
  list(@Query('encounterId', uuid) encounterId: string) {
    return this.pa.listForEncounter(encounterId);
  }

  @RequirePermission('lab.result', 'release')
  @Post('reports')
  create(@Body(new ZodValidationPipe(paReportCreateInputSchema)) body: PaReportCreateInput) {
    return this.pa.create(body);
  }

  @RequirePermission('lab.result', 'release')
  @Post('reports/:id/sign')
  sign(@Param('id', uuid) id: string) {
    return this.pa.sign(id);
  }
}
