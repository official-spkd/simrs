import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type MatchListQuery,
  matchListSchema,
  mergeCandidateSchema,
  type MergeCandidateInput,
  mpiDecisionSchema,
  type MpiDecisionInput,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MpiMatchService } from './mpi-match.service';

const uuid = new ParseUUIDPipe();

/**
 * P05 · Layar MPI: antrean kemungkinan rekam medis ganda dan keputusan petugas rekam medis (`patient.merge`).
 * Audit ditulis service untuk kedua pasien setiap pasangan (bukan `@Audited`, yang hanya satu entri).
 */
@ApiTags('mpi (P05)')
@TenantScoped()
@RequireModule('P05')
@RequirePermission('patient', 'merge')
@Controller('mpi')
export class MpiMatchController {
  constructor(private readonly match: MpiMatchService) {}

  @Get('candidates')
  list(@Query(new ZodValidationPipe(matchListSchema)) q: MatchListQuery) {
    return this.match.list(q);
  }

  @Get('candidates/:id')
  compare(@Param('id', uuid) id: string) {
    return this.match.compare(id);
  }

  @Post('candidates/:id/merge')
  @HttpCode(200)
  merge(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(mergeCandidateSchema)) body: MergeCandidateInput,
  ) {
    return this.match.merge(id, body);
  }

  @Post('candidates/:id/distinct')
  @HttpCode(200)
  distinct(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(mpiDecisionSchema)) body: MpiDecisionInput,
  ) {
    return this.match.distinct(id, body);
  }

  @Post('candidates/:id/reopen')
  @HttpCode(200)
  reopen(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(mpiDecisionSchema)) body: MpiDecisionInput,
  ) {
    return this.match.reopen(id, body);
  }

  @Post('links/:id/undo')
  @HttpCode(200)
  undo(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(mpiDecisionSchema)) body: MpiDecisionInput,
  ) {
    return this.match.undo(id, body);
  }
}
