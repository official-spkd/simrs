import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CARE_SETTINGS,
  type CarePackageItemInput,
  carePackageItemInputSchema,
  carePackagesQuerySchema,
  type CareSetting,
} from '@simrs/shared';
import { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CarePackagesService } from './care-packages.service';

const settingParam = new ZodValidationPipe(z.enum(CARE_SETTINGS));
const formCodeParam = new ZodValidationPipe(z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Kode formulir tidak valid'));

/** K15 · `/api/v1/care-packages`: paket formulir per setting (baca semua staf berizin formulir; ubah = pengelola formulir). */
@ApiTags('klinis · paket formulir (K15)')
@TenantScoped()
@RequireModule('K15')
@Controller('care-packages')
export class CarePackagesController {
  constructor(private readonly packages: CarePackagesService) {}

  @RequirePermission('forms.definition', 'read')
  @Get()
  list(@Query(new ZodValidationPipe(carePackagesQuerySchema)) q: { setting: CareSetting }) {
    return this.packages.list(q.setting);
  }

  @RequirePermission('forms.definition', 'write')
  @Put(':setting/:formCode')
  upsert(
    @Param('setting', settingParam) setting: CareSetting,
    @Param('formCode', formCodeParam) formCode: string,
    @Body(new ZodValidationPipe(carePackageItemInputSchema)) body: CarePackageItemInput,
  ) {
    return this.packages.upsert(setting, formCode, body);
  }
}

/** K15 · `GET /api/v1/encounters/:id/completeness`: kelengkapan asesmen kunjungan menurut paket setting-nya. */
@ApiTags('klinis · paket formulir (K15)')
@TenantScoped()
@RequireModule('K15')
@Controller('encounters')
export class EncounterCompletenessController {
  constructor(private readonly packages: CarePackagesService) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/completeness')
  completeness(@Param('id', ParseUUIDPipe) id: string) {
    return this.packages.completeness(id);
  }
}
