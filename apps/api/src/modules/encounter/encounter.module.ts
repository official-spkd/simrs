import { Module } from '@nestjs/common';
import { AdtModule } from '../adt/adt.module';
import { AuthzModule } from '../authz/authz.module';
import { SepModule } from '../sep/sep.module';
import { EmergencySepService } from './emergency-sep.service';
import { EncounterController } from './encounter.controller';
import { PoliController, PoliVisitController } from './poli.controller';
import { PoliService } from './poli.service';

/**
 * K02 · Konteks kunjungan klinis. Bagian ADT/IGD (potongan 3.3): SEP IGD otomatis (`EmergencySepService`, juga dipakai
 * registrasi IGD). Layar Pemeriksaan poli mode api (W1): `GET /poli/worklist` dan `GET /encounters/:id/poli-visit`
 * (`PoliService`, hanya membaca dan menyusun dari sumber klinis).
 */
@Module({
  imports: [AuthzModule, SepModule, AdtModule],
  controllers: [EncounterController, PoliController, PoliVisitController],
  providers: [EmergencySepService, PoliService],
  exports: [EmergencySepService],
})
export class EncounterModule {}
