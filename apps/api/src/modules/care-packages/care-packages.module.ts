import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CarePackagesController, EncounterCompletenessController } from './care-packages.controller';
import { CarePackagesService } from './care-packages.service';

/**
 * K15 · Paket formulir per setting dan kelengkapan asesmen kunjungan (potongan 3.8, EP 6b/7a, ADR-0059). Didaftarkan
 * sekali di `AppModule` (potongan 3.1).
 */
@Module({
  imports: [AuthzModule],
  controllers: [CarePackagesController, EncounterCompletenessController],
  providers: [CarePackagesService],
})
export class CarePackagesModule {}
