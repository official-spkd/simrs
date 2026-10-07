import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DietOrderInput,
  dietOrderInputSchema,
  type MealListQuery,
  mealListQuerySchema,
  mealServiceInputSchema,
} from '@simrs/shared';
import type { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { NutritionService } from './nutrition.service';

const uuid = new ParseUUIDPipe();

/** S07 · `/api/v1/nutrition/*`: jenis diet, order diet, daftar makan per jam makan, layanan makan + sisa. */
@ApiTags('penunjang · gizi (S07)')
@TenantScoped()
@RequireModule('S07')
@Controller('nutrition')
export class NutritionController {
  constructor(private readonly nutrition: NutritionService) {}

  @RequirePermission('nutrition', 'read')
  @Get('diet-types')
  dietTypes() {
    return this.nutrition.dietTypes();
  }

  @RequirePermission('nutrition', 'write')
  @Post('diet-orders')
  order(@Body(new ZodValidationPipe(dietOrderInputSchema)) body: DietOrderInput) {
    return this.nutrition.order(body);
  }

  @RequirePermission('nutrition', 'write')
  @Post('diet-orders/:id/end')
  end(@Param('id', uuid) id: string) {
    return this.nutrition.end(id);
  }

  @RequirePermission('nutrition', 'read')
  @Get('meal-list')
  mealList(@Query(new ZodValidationPipe(mealListQuerySchema)) q: MealListQuery) {
    return this.nutrition.mealList(q);
  }

  @RequirePermission('nutrition', 'write')
  @Post('meal-services')
  recordMeal(
    @Body(new ZodValidationPipe(mealServiceInputSchema)) body: z.infer<typeof mealServiceInputSchema>,
  ) {
    return this.nutrition.recordMeal(body);
  }
}

/** S07 · Rute per kunjungan (bentuk kanonik): riwayat order diet. */
@ApiTags('penunjang · gizi (S07)')
@TenantScoped()
@RequireModule('S07')
@Controller('encounters')
export class EncounterNutritionController {
  constructor(private readonly nutrition: NutritionService) {}

  @RequirePermission('nutrition', 'read')
  @Get(':id/diet-orders')
  list(@Param('id', uuid) id: string) {
    return this.nutrition.listForEncounter(id);
  }
}
