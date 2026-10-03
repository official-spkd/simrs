import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, TenantGuard } from './tenant-context';
import { TenancyService, type TenantView } from './tenancy.service';

@ApiTags('tenancy')
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'UUID tenant (fase 0, non-produksi)' })
@UseGuards(TenantGuard)
@Controller('tenancy')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('current')
  current(@CurrentTenant() tenantId: string): Promise<TenantView> {
    return this.tenancy.current(tenantId);
  }
}
