import { Module } from '@nestjs/common';
import { TenantGuard } from './tenant-context';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

/** P01 (minimal fase 0): konteks tenant + baca tenant aktif. */
@Module({
  controllers: [TenancyController],
  providers: [TenancyService, TenantGuard],
  exports: [TenancyService],
})
export class TenancyModule {}
