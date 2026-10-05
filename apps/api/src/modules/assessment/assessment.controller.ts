import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { EncounterAssessment } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { AssessmentService } from './assessment.service';

/** K06 · `GET /api/v1/assessment/encounters/:id`: asesmen (isian formulir P07) satu kunjungan. */
@ApiTags('klinis · asesmen (K06)')
@TenantScoped()
@RequireModule('K06')
@Controller('assessment')
export class AssessmentController {
  constructor(private readonly assessment: AssessmentService) {}

  @RequirePermission('clinical', 'read')
  @Get('encounters/:id')
  forEncounter(@Param('id', new ParseUUIDPipe()) id: string): Promise<EncounterAssessment[]> {
    return this.assessment.forEncounter(id);
  }
}
