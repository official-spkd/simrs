import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ConsultantSearchQuery,
  consultantSearchQuerySchema,
  type ConsultRequestInput,
  consultRequestInputSchema,
  type ConsultResponseInput,
  consultResponseInputSchema,
  type PrimaryDpjpChangeInput,
  primaryDpjpChangeInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConsultService } from './consult.service';

const uuid = new ParseUUIDPipe();

/**
 * K10 · `/api/v1/consults/*`: permintaan konsultasi/rawat bersama/alih rawat, jawaban (hanya konsultan tujuan),
 * kotak masuk konsultan. Audit di service (dengan pasien).
 */
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
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consultResponseInputSchema)) body: ConsultResponseInput,
  ) {
    return this.consult.respond(id, body);
  }

  @RequirePermission('clinical', 'write')
  @Get('consultants')
  consultants(@Query(new ZodValidationPipe(consultantSearchQuerySchema)) q: ConsultantSearchQuery) {
    return this.consult.consultants(q);
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
  list(@Param('id', uuid) id: string) {
    return this.consult.list(id);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/care-team')
  careTeam(@Param('id', uuid) id: string) {
    return this.consult.careTeamOf(id);
  }

  @RequirePermission('clinical', 'write')
  @Post(':id/care-team/primary')
  changePrimary(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(primaryDpjpChangeInputSchema)) body: PrimaryDpjpChangeInput,
  ) {
    return this.consult.changePrimary(id, body);
  }
}
