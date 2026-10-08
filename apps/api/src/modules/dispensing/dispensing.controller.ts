import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type DispenseHandoverInput,
  dispenseHandoverInputSchema,
  type DispenseLabelView,
  type DispensePrepareInput,
  dispensePrepareInputSchema,
  type DispenseReturnInput,
  dispenseReturnInputSchema,
  type DispenseView,
} from '@simrs/shared';
import type { Response } from 'express';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DispensingService } from './dispensing.service';

const uuid = new ParseUUIDPipe();

/**
 * S05 · Dispensing (`/api/v1/dispensing`, rencana fase 4 §4.6b): penyiapan FEFO + label dosis, cek ganda apoteker
 * kedua, serah terima (titik tagih obat), retur, dan label untuk eMAR. Izin `pharmacy.dispense.*` berlingkup depo unit;
 * retur perawat berlingkup relasi pasien. Tulisan yang mengubah stok wajib header `Idempotency-Key`.
 */
@ApiTags('penunjang · dispensing (S05)')
@TenantScoped()
@RequireModule('S05')
@Controller('dispensing')
export class DispensingController {
  constructor(private readonly dispensing: DispensingService) {}

  /** Penyiapan resep `penyiapan`: FEFO otomatis per item atau batch pilihan beralasan. 201 baru, 200 ulangan kunci. */
  @RequirePermission('pharmacy.dispense', 'prepare')
  @Post('prescriptions/:id/prepare')
  async prepare(
    @Headers('idempotency-key') key: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(dispensePrepareInputSchema)) body: DispensePrepareInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DispenseView> {
    const r = await this.dispensing.prepare(key, id, body);
    res.status(r.created ? 201 : 200);
    return r.view;
  }

  @RequirePermission('pharmacy.review', 'read')
  @Get('prescriptions/:id/dispenses')
  forPrescription(@Param('id', uuid) id: string): Promise<DispenseView[]> {
    return this.dispensing.forPrescription(id);
  }

  @RequirePermission('pharmacy.review', 'read')
  @Get('dispenses/:id')
  view(@Param('id', uuid) id: string): Promise<DispenseView> {
    return this.dispensing.viewScoped(id);
  }

  /** Cek ganda apoteker kedua (bukan penyiap) dari sesinya sendiri. */
  @RequirePermission('pharmacy.dispense', 'double_check')
  @Post('dispenses/:id/double-check')
  @HttpCode(200)
  doubleCheck(@Param('id', uuid) id: string): Promise<DispenseView> {
    return this.dispensing.doubleCheck(id);
  }

  @RequirePermission('pharmacy.dispense', 'handover')
  @Post('dispenses/:id/handover')
  @HttpCode(200)
  handover(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(dispenseHandoverInputSchema)) body: DispenseHandoverInput,
  ): Promise<DispenseView> {
    return this.dispensing.handover(id, body);
  }

  /** Retur obat yang sudah diserahkan. Header `Idempotency-Key` wajib. */
  @RequirePermission('pharmacy.dispense', 'return')
  @Post('dispenses/:id/returns')
  async returns(
    @Headers('idempotency-key') key: string | undefined,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(dispenseReturnInputSchema)) body: DispenseReturnInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DispenseView> {
    const r = await this.dispensing.returns(key, id, body);
    res.status(r.created ? 201 : 200);
    return r.view;
  }

  /** Label dosis untuk eMAR (F3-5): data etiket; pasien harus boleh dibuka pelaku. */
  @RequirePermission('medication', 'administer')
  @Get('labels/:barcode')
  label(@Param('barcode') barcode: string): Promise<DispenseLabelView> {
    return this.dispensing.label(barcode);
  }
}
