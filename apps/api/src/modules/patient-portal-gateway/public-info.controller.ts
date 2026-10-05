import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type PublicBookingStatusQuery,
  publicBookingStatusQuerySchema,
  publicScheduleQuerySchema,
  queueServiceCodeSchema,
} from '@simrs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuthRateLimited } from '../../common/auth-rate-limited.decorator';
import { PublicRateLimited } from '../../common/public-rate-limited.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PublicInfoService, type PublicRequestMeta } from './public-info.service';

function meta(req: Request & { id?: unknown }): PublicRequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}

/**
 * F08 · Gateway informasi publik (`/api/v1/public/:tenantCode/…`): tanpa login, tanpa PHI. Semua endpoint di bawah
 * batas umum per IP; jadwal dan antrean ditambah throttler `public`, cek status booking memakai batas endpoint
 * kredensial (tebakan kode + tanggal lahir). Kode booking dan tanggal lahir hanya di BODY, tidak pernah di URL (log
 * dan riwayat proxy mencatat URL).
 */
@ApiTags('informasi publik (F08)')
@Controller('public/:tenantCode')
export class PublicInfoController {
  constructor(private readonly info: PublicInfoService) {}

  @Get('schedules')
  @PublicRateLimited()
  schedules(
    @Param('tenantCode') tenantCode: string,
    @Query(new ZodValidationPipe(publicScheduleQuerySchema)) q: z.infer<typeof publicScheduleQuerySchema>,
  ) {
    return this.info.schedules(tenantCode, q.date);
  }

  @Get('queues')
  @PublicRateLimited()
  queues(@Param('tenantCode') tenantCode: string) {
    return this.info.queues(tenantCode);
  }

  @Get('queues/:serviceCode')
  @PublicRateLimited()
  queue(
    @Param('tenantCode') tenantCode: string,
    @Param('serviceCode', new ZodValidationPipe(queueServiceCodeSchema)) serviceCode: string,
  ) {
    return this.info.queues(tenantCode, serviceCode);
  }

  @Post('bookings/status')
  @HttpCode(200)
  @AuthRateLimited()
  bookingStatus(
    @Param('tenantCode') tenantCode: string,
    @Body(new ZodValidationPipe(publicBookingStatusQuerySchema)) body: PublicBookingStatusQuery,
    @Req() req: Request,
  ) {
    return this.info.bookingStatus(tenantCode, body, meta(req));
  }
}
