import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  breakGlassReviewSchema,
  type BreakGlassReviewInput,
  breakGlassSchema,
  type BreakGlassInput,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, paramId } from '../../common/audited.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BreakGlassService } from './break-glass.service';
import { PatientAccessService } from './patient-access.service';

const listSchema = z.strictObject({
  pending: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Laporan harian: tanggal WIB. */
  date: z.iso.date().optional(),
});
const uuid = new ParseUUIDPipe();

/** P03 · Akses darurat dan pemeriksaan akses pasien (ABAC). */
@ApiTags('authz (P03)')
@TenantScoped()
@Controller('authz')
export class AuthzController {
  constructor(
    private readonly breakGlass: BreakGlassService,
    private readonly access: PatientAccessService,
  ) {}

  /** Apakah pengguna boleh membuka pasien ini, dan atas dasar apa (untuk UI: tawarkan akses darurat bila tidak). */
  @Get('patients/:patientId/access')
  @RequirePermission('patient', 'read')
  async patientAccess(@Param('patientId', uuid) patientId: string) {
    const basis = await this.access.basis(patientId);
    return { allowed: basis !== null, basis };
  }

  @Post('break-glass')
  @RequirePermission('break_glass', 'use')
  grant(@Body(new ZodValidationPipe(breakGlassSchema)) body: BreakGlassInput) {
    return this.breakGlass.grant(body);
  }

  @Get('break-glass')
  @RequirePermission('break_glass', 'review')
  @Audited({
    action: 'read',
    resource: 'break_glass',
    details: ({ result }) => ({ count: (result as unknown[]).length }),
  })
  list(@Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.breakGlass.list({ pendingOnly: q.pending, limit: q.limit, date: q.date });
  }

  @Get('break-glass/:id')
  @RequirePermission('break_glass', 'review')
  @Audited({
    action: 'read',
    resource: 'break_glass',
    resourceId: paramId,
    patientId: ({ result }) => (result as { patientId: string }).patientId,
  })
  get(@Param('id', uuid) id: string) {
    return this.breakGlass.get(id);
  }

  @Post('break-glass/:id/review')
  @HttpCode(200)
  @RequirePermission('break_glass', 'review')
  review(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(breakGlassReviewSchema)) body: BreakGlassReviewInput,
  ) {
    return this.breakGlass.review(id, body);
  }
}
