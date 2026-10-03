import { Module } from '@nestjs/common';
import { TenancyController } from './tenancy.controller';
import { TenancyRepository } from './tenancy.repository';
import { TenancyService } from './tenancy.service';

/** P01 (minimal fase 0): konteks tenant + baca tenant aktif. */
@Module({
  controllers: [TenancyController],
  providers: [TenancyService, TenancyRepository],
  exports: [TenancyService],
})
export class TenancyModule {}
