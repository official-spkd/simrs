import { Module } from '@nestjs/common';
import { AdtModule } from '../adt/adt.module';
import { AuthzModule } from '../authz/authz.module';
import { TriageController, TriageEncounterController } from './triage.controller';
import { TriageService } from './triage.service';

/**
 * K03 · Triase IGD (potongan 3.3): saran ATS server + pilihan berversi, papan IGD (+ SSE), status alur dan penempatan
 * bed IGD. Staging biaya IGD + SATUSEHAT Encounter (ADR-0032).
 */
@Module({
  imports: [AuthzModule, AdtModule],
  controllers: [TriageController, TriageEncounterController],
  providers: [TriageService],
})
export class TriageModule {}
