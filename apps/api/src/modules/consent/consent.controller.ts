import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AppError,
  type ConsentDraftCancelInput,
  consentDraftCancelInputSchema,
  type ConsentDraftCreateInput,
  consentDraftCreateInputSchema,
  type ConsentDraftRefuseInput,
  consentDraftRefuseInputSchema,
  type ConsentDraftSignaturesInput,
  consentDraftSignaturesInputSchema,
  type ConsentDraftUpdateInput,
  consentDraftUpdateInputSchema,
  type ConsentRevokeInput,
  consentRevokeInputSchema,
  consentSignatureSlotQuerySchema,
} from '@simrs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConsentService } from './consent.service';

const uuid = new ParseUUIDPipe();

/**
 * K11 · `/api/v1/consents/*`: templat (P07), langkah draf tablet (isi, tanda tangan, gambar tanda tangan, atestasi
 * saksi petugas, batal), final/penolakan (`consent.sign`, hanya dokter) dengan PDF + TTE, dan pencabutan. Tablet
 * memakai sesi staf (keputusan fase 3 no. 20). Audit di service (dengan pasien).
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

  @RequirePermission('consent', 'read')
  @Get('drafts/:id')
  draft(@Param('id', uuid) id: string) {
    return this.consent.getDraft(id);
  }

  @RequirePermission('consent', 'write')
  @Put('drafts/:id')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consentDraftUpdateInputSchema)) body: ConsentDraftUpdateInput,
  ) {
    return this.consent.updateDraft(id, body);
  }

  @RequirePermission('consent', 'write')
  @Put('drafts/:id/signatures')
  signatures(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consentDraftSignaturesInputSchema)) body: ConsentDraftSignaturesInput,
  ) {
    return this.consent.setSignatures(id, body);
  }

  /** Body = PNG (`application/octet-stream`, dibaca middleware `rawUpload` sebelum transaksi dibuka). */
  @RequirePermission('consent', 'write')
  @Post('drafts/:id/signature-image')
  signatureImage(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(consentSignatureSlotQuerySchema))
    q: z.infer<typeof consentSignatureSlotQuerySchema>,
    @Req() req: Request,
  ) {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Kirim gambar tanda tangan sebagai application/octet-stream',
        415,
      );
    }
    return this.consent.uploadSignatureImage(id, q.slot, req.body);
  }

  @RequirePermission('consent', 'write')
  @Post('drafts/:id/witness')
  witness(@Param('id', uuid) id: string) {
    return this.consent.attestWitness(id);
  }

  @RequirePermission('consent', 'sign')
  @Post('drafts/:id/finalize')
  finalize(@Param('id', uuid) id: string) {
    return this.consent.finalize(id);
  }

  @RequirePermission('consent', 'sign')
  @Post('drafts/:id/refuse')
  refuse(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consentDraftRefuseInputSchema)) body: ConsentDraftRefuseInput,
  ) {
    return this.consent.refuse(id, body);
  }

  @RequirePermission('consent', 'write')
  @Post('drafts/:id/cancel')
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consentDraftCancelInputSchema)) body: ConsentDraftCancelInput,
  ) {
    return this.consent.cancel(id, body);
  }

  @RequirePermission('consent', 'sign')
  @Post(':id/revoke')
  revoke(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consentRevokeInputSchema)) body: ConsentRevokeInput,
  ) {
    return this.consent.revoke(id, body);
  }
}

/** K11 · Rute per kunjungan (bentuk kanonik): persetujuan final dan draf tablet. */
@ApiTags('klinis · persetujuan tindakan (K11)')
@TenantScoped()
@RequireModule('K11')
@Controller('encounters')
export class EncounterConsentController {
  constructor(private readonly consent: ConsentService) {}

  @RequirePermission('consent', 'read')
  @Get(':id/consents')
  list(@Param('id', uuid) id: string) {
    return this.consent.list(id);
  }

  @RequirePermission('consent', 'read')
  @Get(':id/consent-drafts')
  drafts(@Param('id', uuid) id: string) {
    return this.consent.listDrafts(id);
  }

  @RequirePermission('consent', 'write')
  @Post(':id/consent-drafts')
  createDraft(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(consentDraftCreateInputSchema)) body: ConsentDraftCreateInput,
  ) {
    return this.consent.createDraft(id, body);
  }
}
