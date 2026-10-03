import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { TenancyService, type TenantView } from './tenancy.service';

@ApiTags('tenancy')
@TenantScoped()
@Controller('tenancy')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('current')
  current(): Promise<TenantView> {
    return this.tenancy.current();
  }
}
