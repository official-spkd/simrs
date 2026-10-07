import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { DiagnosisModule } from '../diagnosis/diagnosis.module';
import { EncounterNutritionController, NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';

/** S07 · Gizi (potongan 4.9, ADR-0105). Didaftarkan sekali di `AppModule`. */
@Module({
  imports: [AuthzModule, DiagnosisModule],
  controllers: [NutritionController, EncounterNutritionController],
  providers: [NutritionService],
})
export class NutritionModule {}
