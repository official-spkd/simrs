import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AppError, INTEGRATION_TARGETS } from '@simrs/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { API_ENV, type ApiEnv } from '../../config/env';
import { CurrentTenant, TenantGuard } from './tenant-context';
import { TenancyService } from './tenancy.service';

const pingSchema = z.object({ target: z.enum(INTEGRATION_TARGETS) });

@ApiTags('tenancy')
@ApiHeader({
  name: 'X-Tenant-Id',
  required: true,
  description: 'UUID tenant (fase 0; fase 1 dari token login)',
})
@UseGuards(TenantGuard)
@Controller('tenancy')
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('current')
  current(@CurrentTenant() tenantId: string) {
    return this.tenancy.current(tenantId);
  }

  /** Hanya non-produksi: buat pesan outbox contoh ke mock. */
  @Post('dev/outbox-ping')
  ping(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(pingSchema)) body: z.infer<typeof pingSchema>,
  ) {
    this.assertNonProduction();
    return this.tenancy.enqueuePing(tenantId, body.target);
  }

  @Get('dev/outbox/:id')
  outbox(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    this.assertNonProduction();
    return this.tenancy.outboxStatus(tenantId, id);
  }

  private assertNonProduction(): void {
    if (this.env.NODE_ENV === 'production') {
      throw new AppError('NOT_FOUND', 'Endpoint tidak tersedia', 404);
    }
  }
}
