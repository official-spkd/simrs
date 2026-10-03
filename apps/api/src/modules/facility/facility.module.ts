import { Module } from '@nestjs/common';
import { FacilityController } from './facility.controller';
import { FacilityRepository } from './facility.repository';
import { FacilityService } from './facility.service';

/** P01 · Struktur RS. Diekspor agar modul lain (registrasi, ADT, bed) bisa memvalidasi unit/lokasi. */
@Module({
  controllers: [FacilityController],
  providers: [FacilityService, FacilityRepository],
  exports: [FacilityService],
})
export class FacilityModule {}
