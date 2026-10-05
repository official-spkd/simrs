import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type EdStatusInput,
  edStatusInputSchema,
  type TriageAssessmentInput,
  triageAssessmentInputSchema,
} from '@simrs/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited } from '../../common/audited.decorator';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { edBoardChannel } from '../../infra/clinical/clinical-channels';
import { SseService } from '../../infra/realtime/sse.service';
import { TenantDb } from '../../infra/tenant-db';
import { TriageService } from './triage.service';

const boardQuery = z.strictObject({ unitId: z.uuid().optional() });

/**
 * K03 · Triase IGD dan papan IGD (`/api/v1/triage`, rencana fase 3 §3.3). Triase `triage.write` (perawat, bidan,
 * dokter, residen, pendaftaran IGD); papan `clinical.read`; SSE `/triage/board/events` (potret `ed.board` + `ed.status`). Status alur per kunjungan
 * di `TriageEncounterController`.
 */
@ApiTags('klinis · triase IGD (K03)')
@TenantScoped()
@RequireModule('K03')
@Controller('triage')
export class TriageController {
  constructor(
    private readonly triage: TriageService,
    private readonly sse: SseService,
    private readonly db: TenantDb,
  ) {}

  @RequirePermission('triage', 'write')
  @Post('assessments')
  assess(@Body(new ZodValidationPipe(triageAssessmentInputSchema)) body: TriageAssessmentInput) {
    return this.triage.assess(body);
  }

  @RequirePermission('clinical', 'read')
  @Get('board')
  board(@Query(new ZodValidationPipe(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.triage.board(q.unitId);
  }

  @RequirePermission('clinical', 'read')
  @NoRequestTransaction()
  @Audited({ action: 'read', resource: 'ed_board_stream' })
  @Get('board/events')
  async events(@Req() req: Request, @Res() res: Response) {
    const scope = this.db.permissionScope();
    const unitId = scope === 'all' ? null : (this.db.actor().unitId ?? '');
    this.sse.stream(req, res, edBoardChannel, {
      filter: (e) => unitId === null || e.data.unitId === unitId,
      initial: async () => [{ event: 'ed.board', data: await this.triage.board() }],
    });
  }
}

/**
 * K03 · Status alur IGD per kunjungan (`POST /api/v1/encounters/:id/ed-status`, bentuk rute per-kunjungan kanonik
 * fase 3): status + zona + penempatan bed IGD, `triage.write` berlingkup unit.
 */
@ApiTags('klinis · triase IGD (K03)')
@TenantScoped()
@RequireModule('K03')
@Controller('encounters')
export class TriageEncounterController {
  constructor(private readonly triage: TriageService) {}

  @RequirePermission('triage', 'write')
  @Post(':id/ed-status')
  status(
    @Param('id', ParseUUIDPipe) encounterId: string,
    @Body(new ZodValidationPipe(edStatusInputSchema)) body: EdStatusInput,
  ) {
    return this.triage.setStatus(encounterId, body);
  }
}
