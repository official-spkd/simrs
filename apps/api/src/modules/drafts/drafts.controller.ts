import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type ClinicalDraft, type ClinicalDraftInput, clinicalDraftInputSchema } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DraftsService } from './drafts.service';

const uuid = new ParseUUIDPipe();

/**
 * Draf klinis penulis (`/api/v1/drafts/:encounterId/:kind`, ADR-0028 butir 5). Izin `clinical.write` (hanya yang
 * boleh menulis catatan klinis yang menyimpan draf); draf selalu milik pengguna sesi.
 */
@ApiTags('klinis · draf')
@TenantScoped()
@RequireModule('K01')
@Controller('drafts')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @RequirePermission('clinical', 'write')
  @Get(':encounterId/:kind')
  get(@Param('encounterId', uuid) encounterId: string, @Param('kind') kind: string): Promise<ClinicalDraft> {
    return this.drafts.get(encounterId, kind);
  }

  @RequirePermission('clinical', 'write')
  @Put(':encounterId/:kind')
  put(
    @Param('encounterId', uuid) encounterId: string,
    @Param('kind') kind: string,
    @Body(new ZodValidationPipe(clinicalDraftInputSchema)) body: ClinicalDraftInput,
  ): Promise<ClinicalDraft> {
    return this.drafts.put(encounterId, kind, body);
  }

  @RequirePermission('clinical', 'write')
  @Delete(':encounterId/:kind')
  @HttpCode(204)
  remove(@Param('encounterId', uuid) encounterId: string, @Param('kind') kind: string): Promise<void> {
    return this.drafts.remove(encounterId, kind);
  }
}
