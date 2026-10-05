import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ConsentCreateInput,
  consentCreateInputSchema,
  type ConsentRevokeInput,
  consentRevokeInputSchema,
  type ConsentWitnessInput,
  consentWitnessInputSchema,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConsentService } from './consent.service';

/**
 * K11 · `/api/v1/consents/*`: templat (P07), persetujuan/penolakan final (`consent.sign`, hanya dokter) dengan PDF +
 * TTE, dan pencabutan. Tablet memakai sesi staf (keputusan fase 3 no. 20).
 */
@ApiTags('klinis · persetujuan tindakan (K11)')
@TenantScoped()
@RequireModule('K11')
@Controller('consents')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @RequirePermission('consent', 'read')
  @Get('templates')
  templates() {
    return this.consent.templates();
  }

  @RequirePermission('consent', 'sign')
  @Post()
  create(@Body(new ZodValidationPipe(consentCreateInputSchema)) body: ConsentCreateInput) {
    return this.consent.create(body);
  }

  @RequirePermission('consent', 'sign')
  @Post(':id/revoke')
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(consentRevokeInputSchema)) body: ConsentRevokeInput,
  ) {
    return this.consent.revoke(id, body);
  }
}

/** K11 · Rute per kunjungan (bentuk kanonik): daftar persetujuan dan atestasi saksi petugas. */
@ApiTags('klinis · persetujuan tindakan (K11)')
@TenantScoped()
@RequireModule('K11')
@Controller('encounters')
export class EncounterConsentController {
  constructor(private readonly consent: ConsentService) {}

  @RequirePermission('consent', 'read')
  @Get(':id/consents')
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.consent.list(id);
  }

  @RequirePermission('consent', 'write')
  @Post(':id/consent-witness')
  witness(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(consentWitnessInputSchema)) body: ConsentWitnessInput,
  ) {
    return this.consent.attestWitness(id, body);
  }
}
