import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { SepModule } from '../sep/sep.module';
import { EmergencySepService } from './emergency-sep.service';
import { EncounterController } from './encounter.controller';

/**
 * K02 · Konteks kunjungan klinis. Bagian ADT/IGD (potongan 3.3): SEP IGD otomatis (`EmergencySepService`, juga dipakai
 * registrasi IGD). Banner/konteks klinis (`GET /encounter/:id/context`) dibangun potongan 3.2a di folder ini.
 */
@Module({
  imports: [AuthzModule, SepModule],
  controllers: [EncounterController],
  providers: [EmergencySepService],
  exports: [EmergencySepService],
})
export class EncounterModule {}
