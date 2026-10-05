import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AppError,
  type OrderCatalogItem,
  type OrderCatalogQuery,
  orderCancelInputSchema,
  orderCatalogQuerySchema,
  type OrderEvaluation,
  type OrderGroup,
  type OrderSetCreateInput,
  orderSetCreateInputSchema,
  type OrderSetView,
  type OrderSubmitInput,
  orderSubmitInputSchema,
} from '@simrs/shared';
import type { Response } from 'express';
import { NoRequestTransaction } from '../../common/no-request-transaction.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TenantDb } from '../../infra/tenant-db';
import { OrderCatalogService } from './order-catalog.service';
import { OrdersService } from './orders.service';

const uuid = new ParseUUIDPipe();

/**
 * K09 · CPOE (`/api/v1/orders`, rencana fase 3 §3.4): katalog, order set, pratinjau CDS, kirim order (Idempotency-Key),
 * batal beralasan (daftar order kunjungan: `EncounterOrdersController`). Izin `order.*`; akses pasien lewat ABAC di service; semua baca/ubah diaudit.
 */
@ApiTags('klinis · order (CPOE)')
@TenantScoped()
@RequireModule('K09')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly catalogs: OrderCatalogService,
    private readonly db: TenantDb,
  ) {}

  @RequirePermission('order', 'read')
  @Get('catalog')
  catalog(
    @Query(new ZodValidationPipe(orderCatalogQuerySchema)) q: OrderCatalogQuery,
  ): Promise<OrderCatalogItem[]> {
    return this.catalogs.catalog(q);
  }

  @RequirePermission('order', 'read')
  @Get('order-sets')
  orderSets(): Promise<OrderSetView[]> {
    return this.catalogs.orderSets();
  }

  @RequirePermission('order', 'manage')
  @Post('order-sets')
  createOrderSet(
    @Body(new ZodValidationPipe(orderSetCreateInputSchema)) body: OrderSetCreateInput,
  ): Promise<OrderSetView> {
    return this.catalogs.createOrderSet(body);
  }

  /** Pratinjau CDS server: temuan per baris dengan KB RS, tanpa menyimpan apa pun. */
  @RequirePermission('order', 'write')
  @Post('evaluate')
  @HttpCode(200)
  evaluate(
    @Body(new ZodValidationPipe(orderSubmitInputSchema)) body: OrderSubmitInput,
  ): Promise<OrderEvaluation> {
    return this.orders.evaluate(body);
  }

  /**
   * Kirim order. Transaksi pendek sendiri (`@NoRequestTransaction`): kiriman yang ditolak CDS di-commit sebagai
   * `cds_alerts` `diblokir` + audit sebelum 422 `CDS_BLOCKED` dijawab. 201 = kiriman baru, 200 = kiriman yang sama
   * diulang dengan Idempotency-Key yang sama.
   */
  @RequirePermission('order', 'write')
  @NoRequestTransaction()
  @Post('submit')
  async submit(
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(orderSubmitInputSchema)) body: OrderSubmitInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderGroup> {
    const outcome = await this.db.transaction(() => this.orders.submit(key, body));
    if (outcome.kind === 'blocked') {
      const blocked = outcome.evaluation.lines.filter((l) => l.blocked);
      throw new AppError(
        'CDS_BLOCKED',
        `Order diblokir CDS: ${blocked.map((l) => l.name).join(', ')}. Ganti, hapus, atau isi alasan override klinis.`,
        422,
        outcome.evaluation,
      );
    }
    res.status(outcome.kind === 'created' ? 201 : 200);
    return outcome.group;
  }

  @RequirePermission('order', 'cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(orderCancelInputSchema)) body: { reason: string },
  ): Promise<OrderGroup> {
    return this.orders.cancel(id, body.reason);
  }
}

/**
 * K09 · Order per kunjungan, bentuk kanonik rute fase 3 `/api/v1/encounters/:id/<sumber>`: semua kiriman order
 * kunjungan (terbaru dulu) dengan isi beku, status terkini, temuan CDS, dan resep.
 */
@ApiTags('klinis · order (CPOE)')
@TenantScoped()
@RequireModule('K09')
@Controller('encounters')
export class EncounterOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermission('order', 'read')
  @Get(':encounterId/orders')
  forEncounter(@Param('encounterId', uuid) encounterId: string): Promise<OrderGroup[]> {
    return this.orders.forEncounter(encounterId);
  }
}
