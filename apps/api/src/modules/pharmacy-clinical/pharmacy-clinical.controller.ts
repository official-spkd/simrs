import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CdsDecisionInput,
  cdsDecisionInputSchema,
  type PharmacistInterventionInput,
  pharmacistInterventionInputSchema,
  type PharmacistInterventionResponseInput,
  pharmacistInterventionResponseInputSchema,
  type PharmacyIncoming,
  type PharmacyPrescriptionView,
  pharmacyQueueQuerySchema,
  type PharmacyQueueRow,
  type PrescriptionAcceptInput,
  prescriptionAcceptInputSchema,
  type PrescriptionReviewInput,
  prescriptionReviewInputSchema,
  type PrescriptionStatus,
} from '@simrs/shared';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PharmacyClinicalService } from './pharmacy-clinical.service';

const uuid = new ParseUUIDPipe();

/**
 * S04 · Farmasi klinis (`/api/v1/pharmacy`, rencana fase 4 §4.5): antrean kiriman CPOE, resep farmasi, CDS saat telaah,
 * tindak lanjut temuan, intervensi apoteker, dan telaah tiga aspek. Izin `pharmacy.review` berlingkup depo unit
 * penugasan. Jawaban intervensi oleh dokter penulis memakai izin `order.write`.
 */
@ApiTags('penunjang · farmasi klinis (S04)')
@TenantScoped()
@RequireModule('S04')
@Controller('pharmacy')
export class PharmacyClinicalController {
  constructor(private readonly pharmacy: PharmacyClinicalService) {}

  @RequirePermission('pharmacy.review', 'read')
  @Get('incoming')
  incoming(): Promise<PharmacyIncoming[]> {
    return this.pharmacy.incoming();
  }

  @RequirePermission('pharmacy.review', 'read')
  @Get('prescriptions')
  queue(
    @Query(new ZodValidationPipe(pharmacyQueueQuerySchema)) q: { status?: PrescriptionStatus },
  ): Promise<PharmacyQueueRow[]> {
    return this.pharmacy.queue(q.status);
  }

  /** Terima kiriman CPOE ke depo: nomor R, status `telaah`, evaluasi CDS awal. Kiriman sama dua kali → 409. */
  @RequirePermission('pharmacy.review', 'write')
  @Post('prescriptions')
  accept(
    @Body(new ZodValidationPipe(prescriptionAcceptInputSchema)) body: PrescriptionAcceptInput,
  ): Promise<PharmacyPrescriptionView> {
    return this.pharmacy.accept(body);
  }

  @RequirePermission('pharmacy.review', 'read')
  @Get('prescriptions/:id')
  view(@Param('id', uuid) id: string): Promise<PharmacyPrescriptionView> {
    return this.pharmacy.view(id);
  }

  @RequirePermission('pharmacy.review', 'write')
  @Post('prescriptions/:id/cds/evaluate')
  @HttpCode(200)
  evaluate(@Param('id', uuid) id: string): Promise<PharmacyPrescriptionView> {
    return this.pharmacy.evaluate(id);
  }

  @RequirePermission('pharmacy.review', 'write')
  @Post('prescriptions/:id/alerts/:alertId/decision')
  @HttpCode(200)
  decide(
    @Param('id', uuid) id: string,
    @Param('alertId', uuid) alertId: string,
    @Body(new ZodValidationPipe(cdsDecisionInputSchema)) body: CdsDecisionInput,
  ): Promise<PharmacyPrescriptionView> {
    return this.pharmacy.decide(id, alertId, body);
  }

  @RequirePermission('pharmacy.review', 'write')
  @Post('prescriptions/:id/interventions')
  intervene(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(pharmacistInterventionInputSchema)) body: PharmacistInterventionInput,
  ): Promise<PharmacyPrescriptionView> {
    return this.pharmacy.intervene(id, body);
  }

  @RequirePermission('pharmacy.review', 'write')
  @Post('prescriptions/:id/reviews')
  review(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(prescriptionReviewInputSchema)) body: PrescriptionReviewInput,
  ): Promise<PharmacyPrescriptionView> {
    return this.pharmacy.review(id, body);
  }

  /** Dokter penulis menjawab usulan apoteker (sekali). Perubahan order tetap lewat CPOE. */
  @RequirePermission('order', 'write')
  @Post('interventions/:id/response')
  @HttpCode(200)
  respond(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(pharmacistInterventionResponseInputSchema))
    body: PharmacistInterventionResponseInput,
  ): Promise<{ id: string; response: PharmacistInterventionResponseInput['response'] }> {
    return this.pharmacy.respond(id, body);
  }
}
