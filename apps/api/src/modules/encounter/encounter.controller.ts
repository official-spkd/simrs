import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type EmergencySepInput, emergencySepInputSchema } from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { EmergencySepService } from './emergency-sep.service';

const uuid = new ParseUUIDPipe();

/**
 * Kunjungan klinis · bagian ADT/IGD (potongan 3.3): SEP IGD menyusul diagnosa dokter jaga
 * (`POST /api/v1/encounters/:id/emergency-sep`, bentuk rute per-kunjungan kanonik fase 3). Izin `coverage.write`.
 */
@ApiTags('klinis · kunjungan')
@TenantScoped()
@RequireModule('F06')
@Controller('encounters')
export class EncounterController {
  constructor(private readonly emergencySep: EmergencySepService) {}

  @RequirePermission('coverage', 'write')
  @Post(':id/emergency-sep')
  sep(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(emergencySepInputSchema)) body: EmergencySepInput,
  ) {
    return this.emergencySep.request(id, body);
  }
}
