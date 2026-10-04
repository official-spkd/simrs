import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  REF_CODE_SYSTEM_IDS,
  type RefCodeSystem,
  type RefRegionsQuery,
  refRegionsSchema,
  type RefSearchQuery,
  refSearchSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RefService } from './ref.service';

const systemParam = z.enum(REF_CODE_SYSTEM_IDS);
const codeParam = z.string().trim().min(1).max(20);

/** P06 · Master data rujukan (ICD-10, ICD-9-CM, LOINC, KFA, wilayah), hanya baca. */
@ApiTags('ref (P06)')
@TenantScoped()
@RequireModule('P06')
@RequirePermission('ref', 'read')
@Controller('ref')
export class RefController {
  constructor(private readonly ref: RefService) {}

  @Get('systems')
  systems() {
    return this.ref.systems();
  }

  @Get('concepts')
  search(@Query(new ZodValidationPipe(refSearchSchema)) q: RefSearchQuery) {
    return this.ref.search(q);
  }

  @Get('concepts/:system/:code')
  get(
    @Param('system', new ZodValidationPipe(systemParam)) system: RefCodeSystem,
    @Param('code', new ZodValidationPipe(codeParam)) code: string,
  ) {
    return this.ref.get(system, code);
  }

  @Get('regions')
  regions(@Query(new ZodValidationPipe(refRegionsSchema)) q: RefRegionsQuery) {
    return this.ref.regions(q);
  }
}
