import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { addIsoDays } from '@simrs/db';
import {
  generateSessionsSchema,
  hfisPullSchema,
  type HfisPullInput,
  hfisPushSchema,
  type HfisPushInput,
  isoDateJakarta,
  recordLeaveSchema,
  type RecordLeaveInput,
  scheduleSessionQuerySchema,
  scheduleTemplateInputSchema,
  type ScheduleTemplateInput,
  scheduleTemplateQuerySchema,
  scheduleWeekQuerySchema,
  serviceDateSchema,
  todayQuotaQuerySchema,
  transferBookingsSchema,
  type TransferBookingsInput,
  updateScheduleTemplateSchema,
  type UpdateScheduleTemplateInput,
  updateSessionQuotaSchema,
  type UpdateSessionQuotaInput,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, bodyReason, changedFields, paramId, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SchedulingService } from './scheduling.service';

const uuid = new ParseUUIDPipe();
const differencesQuerySchema = z
  .strictObject({ from: serviceDateSchema.optional(), to: serviceDateSchema.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'Tanggal akhir sebelum tanggal awal' })
  .refine(
    (v) => !v.from || !v.to || Date.parse(v.to) - Date.parse(v.from) <= 30 * 86_400_000,
    'Rentang maksimal 31 hari',
  );

/** Hasil sebagai detail audit (hanya angka/nama field, tanpa PHI). */
const counts =
  (...keys: string[]) =>
  ({ result }: { result: unknown }) =>
    typeof result === 'object' && result !== null
      ? Object.fromEntries(keys.map((k) => [k, (result as Record<string, unknown>)[k]]))
      : undefined;

/**
 * F01 · Jadwal praktik dan kuota (`/api/v1/scheduling`). Baca `schedule.read`; ubah templat/kuota/cuti/pengalihan
 * `schedule.write`; kirim/tarik HFIS `schedule.sync` (202: diantrekan ke outbox, dikirim worker).
 */
@ApiTags('scheduling (F01)')
@TenantScoped()
@RequireModule('F01')
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @RequirePermission('schedule', 'read')
  @Get('week')
  week(@Query(new ZodValidationPipe(scheduleWeekQuerySchema)) q: z.infer<typeof scheduleWeekQuerySchema>) {
    return this.scheduling.week(q.weekStart, q.serviceId);
  }

  @RequirePermission('schedule', 'read')
  @Get('quotas/today')
  todayQuotas(@Query(new ZodValidationPipe(todayQuotaQuerySchema)) q: z.infer<typeof todayQuotaQuerySchema>) {
    return this.scheduling.todayQuotas(q);
  }

  @RequirePermission('schedule', 'read')
  @Get('sessions')
  sessions(
    @Query(new ZodValidationPipe(scheduleSessionQuerySchema)) q: z.infer<typeof scheduleSessionQuerySchema>,
  ) {
    return this.scheduling.sessions(q);
  }

  @RequirePermission('schedule', 'write')
  @Post('sessions/generate')
  @HttpCode(200)
  @Audited({ action: 'create', resource: 'schedule_session', details: counts('from', 'to', 'created') })
  generate(
    @Body(new ZodValidationPipe(generateSessionsSchema)) body: z.infer<typeof generateSessionsSchema>,
  ) {
    return this.scheduling.generate(body);
  }

  @RequirePermission('schedule', 'read')
  @Get('sessions/:id')
  session(@Param('id', uuid) id: string) {
    return this.scheduling.session(id);
  }

  @RequirePermission('schedule', 'write')
  @Patch('sessions/:id/quota')
  @Audited({ action: 'update', resource: 'schedule_session', resourceId: paramId, details: changedFields })
  updateQuota(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateSessionQuotaSchema)) body: UpdateSessionQuotaInput,
  ) {
    return this.scheduling.updateQuota(id, body);
  }

  @RequirePermission('schedule', 'write')
  @Post('sessions/:id/leave')
  @HttpCode(200)
  @Audited({
    action: 'update',
    resource: 'schedule_session',
    resourceId: paramId,
    reason: bodyReason,
    details: ({ result }) => ({
      kind: 'cuti',
      affectedBookings: (result as { affectedBookings?: number } | undefined)?.affectedBookings,
    }),
  })
  recordLeave(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(recordLeaveSchema)) body: RecordLeaveInput,
  ) {
    return this.scheduling.recordLeave(id, body);
  }

  @RequirePermission('schedule', 'write')
  @Post('sessions/:id/transfer')
  @HttpCode(200)
  @Audited({
    action: 'update',
    resource: 'schedule_session',
    resourceId: paramId,
    details: counts('moved', 'notified'),
  })
  transfer(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(transferBookingsSchema)) body: TransferBookingsInput,
  ) {
    return this.scheduling.transfer(id, body);
  }

  @RequirePermission('schedule', 'read')
  @Get('templates')
  templates(
    @Query(new ZodValidationPipe(scheduleTemplateQuerySchema)) q: z.infer<typeof scheduleTemplateQuerySchema>,
  ) {
    return this.scheduling.templates(q);
  }

  @RequirePermission('schedule', 'write')
  @Post('templates')
  @Audited({ action: 'create', resource: 'practitioner_schedule', resourceId: resultId })
  createTemplate(@Body(new ZodValidationPipe(scheduleTemplateInputSchema)) body: ScheduleTemplateInput) {
    return this.scheduling.createTemplate(body);
  }

  @RequirePermission('schedule', 'write')
  @Patch('templates/:id')
  @Audited({
    action: 'update',
    resource: 'practitioner_schedule',
    resourceId: paramId,
    details: changedFields,
  })
  updateTemplate(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateScheduleTemplateSchema)) body: UpdateScheduleTemplateInput,
  ) {
    return this.scheduling.updateTemplate(id, body);
  }

  @RequirePermission('schedule', 'read')
  @Get('hfis/differences')
  differences(
    @Query(new ZodValidationPipe(differencesQuerySchema)) q: z.infer<typeof differencesQuerySchema>,
  ) {
    const from = q.from ?? isoDateJakarta(new Date());
    return this.scheduling.differences(from, q.to ?? addIsoDays(from, 13));
  }

  @RequirePermission('schedule', 'sync')
  @Post('hfis/push')
  @HttpCode(202)
  @Audited({ action: 'export', resource: 'hfis_schedule', details: counts('queued', 'skipped') })
  hfisPush(@Body(new ZodValidationPipe(hfisPushSchema)) body: HfisPushInput) {
    return this.scheduling.hfisPush(body);
  }

  @RequirePermission('schedule', 'sync')
  @Post('hfis/pull')
  @HttpCode(202)
  @Audited({ action: 'read', resource: 'hfis_schedule', details: counts('queued') })
  hfisPull(@Body(new ZodValidationPipe(hfisPullSchema)) body: HfisPullInput) {
    return this.scheduling.hfisPull(body);
  }
}
