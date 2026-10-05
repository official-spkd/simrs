import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ClinicalAttestationInput,
  clinicalAttestationInputSchema,
  type ClinicalEnteredInErrorInput,
  clinicalEnteredInErrorInputSchema,
  type CpptCreateInput,
  cpptCreateInputSchema,
  type HandoverInput,
  handoverInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CpptService } from './cppt.service';

const uuid = new ParseUUIDPipe();
const attestation = new ZodValidationPipe(clinicalAttestationInputSchema);

/**
 * K07 · `/api/v1/cppt/*`: CPPT multi-PPA (entri baru/koreksi/addendum lewat `revision`), salah entri, co-sign DPJP atas
 * catatan residen, verifikasi DPJP atas catatan PPA lain, dan serah terima SBAR. PPA dan penulis dari sesi.
 */
@ApiTags('klinis · CPPT dan serah terima (K07)')
@TenantScoped()
@RequireModule('K07')
@Controller('cppt')
export class CpptController {
  constructor(private readonly cppt: CpptService) {}

  @RequirePermission('clinical', 'write')
  @Post('entries')
  create(@Body(new ZodValidationPipe(cpptCreateInputSchema)) body: CpptCreateInput) {
    return this.cppt.create(body);
  }

  @RequirePermission('clinical', 'correct')
  @Post('entries/:id/entered-in-error')
  enteredInError(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(clinicalEnteredInErrorInputSchema)) body: ClinicalEnteredInErrorInput,
  ) {
    return this.cppt.enteredInError(id, body.reason);
  }

  @RequirePermission('clinical', 'cosign')
  @Post('entries/:id/cosign')
  cosign(@Param('id', uuid) id: string, @Body(attestation) body: ClinicalAttestationInput) {
    return this.cppt.cosign(id, body);
  }

  @RequirePermission('clinical', 'cosign')
  @Post('entries/:id/verify')
  verify(@Param('id', uuid) id: string, @Body(attestation) body: ClinicalAttestationInput) {
    return this.cppt.verify(id, body);
  }

  @RequirePermission('clinical', 'write')
  @Post('handovers')
  handover(@Body(new ZodValidationPipe(handoverInputSchema)) body: HandoverInput) {
    return this.cppt.handover(body);
  }
}

/** K07 · Daftar per kunjungan, rute kanonik `/api/v1/encounters/:id/cppt` dan `/api/v1/encounters/:id/handovers`. */
@ApiTags('klinis · CPPT dan serah terima (K07)')
@TenantScoped()
@RequireModule('K07')
@Controller('encounters')
export class EncounterCpptController {
  constructor(private readonly cppt: CpptService) {}

  @RequirePermission('clinical', 'read')
  @Get(':id/cppt')
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.cppt.list(id);
  }

  @RequirePermission('clinical', 'read')
  @Get(':id/handovers')
  handovers(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.cppt.handovers(id);
  }
}
