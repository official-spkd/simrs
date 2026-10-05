import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type Worklist, type WorklistView, worklistQuerySchema } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { WorklistService } from './worklist.service';

/** K01 · `GET /api/v1/worklist?view=dpjp|unit|shift|tugas`: pasien + tugas klinis pengguna sesi. */
@ApiTags('klinis · worklist (K01)')
@TenantScoped()
@RequireModule('K01')
@Controller('worklist')
export class WorklistController {
  constructor(private readonly worklist: WorklistService) {}

  @RequirePermission('clinical', 'read')
  @Get()
  get(@Query(new ZodValidationPipe(worklistQuerySchema)) q: { view: WorklistView }): Promise<Worklist> {
    return this.worklist.get(q.view);
  }
}
