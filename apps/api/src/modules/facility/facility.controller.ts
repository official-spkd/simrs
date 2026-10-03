import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createFacilitySchema,
  type CreateFacilityInput,
  createLocationSchema,
  type CreateLocationInput,
  createUnitSchema,
  type CreateUnitInput,
  LOCATION_KINDS,
  listQuerySchema,
  UNIT_KINDS,
  updateFacilitySchema,
  type UpdateFacilityInput,
  updateLocationSchema,
  type UpdateLocationInput,
  updateUnitSchema,
  type UpdateUnitInput,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, changedFields, paramId, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { FacilityService } from './facility.service';

const unitListSchema = listQuerySchema.extend({
  facilityId: z.uuid().optional(),
  kind: z.enum(UNIT_KINDS).optional(),
});
const locationListSchema = listQuerySchema.extend({
  unitId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  kind: z.enum(LOCATION_KINDS).optional(),
});
const uuid = new ParseUUIDPipe();

/**
 * P01 · Struktur RS: faskes, unit, lokasi (ruang → kamar → bed).
 * Semua perubahan diaudit (nama field saja). Izin per peran (admin_tenant) dipasang di P03.
 */
@ApiTags('facility (P01)')
@TenantScoped()
@RequireModule('P01')
@Controller('facility')
export class FacilityController {
  constructor(private readonly facility: FacilityService) {}

  @Get('facilities')
  listFacilities(@Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.facility.listFacilities(q);
  }

  @Post('facilities')
  @Audited({ action: 'create', resource: 'facility', resourceId: resultId })
  createFacility(@Body(new ZodValidationPipe(createFacilitySchema)) body: CreateFacilityInput) {
    return this.facility.createFacility(body);
  }

  @Patch('facilities/:id')
  @Audited({ action: 'update', resource: 'facility', resourceId: paramId, details: changedFields })
  updateFacility(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateFacilitySchema)) body: UpdateFacilityInput,
  ) {
    return this.facility.updateFacility(id, body);
  }

  @Get('units')
  listUnits(@Query(new ZodValidationPipe(unitListSchema)) q: z.infer<typeof unitListSchema>) {
    return this.facility.listUnits(q);
  }

  @Post('units')
  @Audited({ action: 'create', resource: 'unit', resourceId: resultId })
  createUnit(@Body(new ZodValidationPipe(createUnitSchema)) body: CreateUnitInput) {
    return this.facility.createUnit(body);
  }

  @Patch('units/:id')
  @Audited({ action: 'update', resource: 'unit', resourceId: paramId, details: changedFields })
  updateUnit(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) body: UpdateUnitInput,
  ) {
    return this.facility.updateUnit(id, body);
  }

  @Get('locations')
  listLocations(@Query(new ZodValidationPipe(locationListSchema)) q: z.infer<typeof locationListSchema>) {
    return this.facility.listLocations(q);
  }

  @Post('locations')
  @Audited({ action: 'create', resource: 'location', resourceId: resultId })
  createLocation(@Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocationInput) {
    return this.facility.createLocation(body);
  }

  @Patch('locations/:id')
  @Audited({ action: 'update', resource: 'location', resourceId: paramId, details: changedFields })
  updateLocation(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationInput,
  ) {
    return this.facility.updateLocation(id, body);
  }
}
