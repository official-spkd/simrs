import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { INTEGRATION_TARGETS } from '@simrs/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant-context';
import { DevToolsService } from './dev-tools.service';

const pingSchema = z.strictObject({ target: z.enum(INTEGRATION_TARGETS) });
type PingBody = z.infer<typeof pingSchema>;

/** Endpoint bantu pengembangan. Modulnya hanya didaftarkan bila dev tools aktif (lihat AppModule). */
@ApiTags('dev (non-produksi)')
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@UseGuards(TenantGuard)
@Controller('dev')
export class DevToolsController {
  constructor(private readonly dev: DevToolsService) {}

  @Post('outbox-ping')
  ping(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(pingSchema)) body: PingBody) {
    return this.dev.enqueuePing(tenantId, body.target);
  }

  @Get('outbox/:id')
  outbox(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.dev.outboxStatus(tenantId, id);
  }
}
