import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ConsultRequestInput,
  consultRequestInputSchema,
  type ConsultResponseInput,
  consultResponseInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConsultService } from './consult.service';

/** K10 · `/api/v1/consults/*`: permintaan konsultasi/rawat bersama/alih rawat, jawaban, kotak masuk konsultan. */
@ApiTags('klinis · konsultasi (K10)')
@TenantScoped()
@RequireModule('K10')
@Controller('consults')
export class ConsultController {
  constructor(private readonly consult: ConsultService) {}

  @RequirePermission('clinical', 'write')
  @Post('requests')
  create(@Body(new ZodValidationPipe(consultRequestInputSchema)) body: ConsultRequestInput) {
    return this.consult.createRequest(body);
  }

  @RequirePermission('clinical', 'write')
  @Post('requests/:id/responses')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(consultResponseInputSchema)) body: ConsultResponseInput,
  ) {
    return this.consult.respond(id, body);
  }

  @RequirePermission('clinical', 'read')
  @Get('inbox')
  inbox() {
    return this.consult.inbox();
  }
}

/** K10 · Rute per kunjungan (bentuk kanonik): konsultasi dan tim perawatan. */
@ApiTags('klinis · konsultasi (K10)')
@TenantScoped()
@RequireModule('K10')
@Controller('encounters')
export class EncounterConsultController {
  constructor(private readonly consult: ConsultService) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/consults')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.consult.list(id);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/care-team')
  careTeam(@Param('id', ParseUUIDPipe) id: string) {
    return this.consult.careTeam(id);
  }
}
