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
  type StockAdjustmentInput,
  stockAdjustmentInputSchema,
  type StockAdjustmentView,
  type StockBalance,
  type StockBalanceQuery,
  stockBalanceQuerySchema,
  stockDrugQuerySchema,
  type StockDrugView,
  type StockLocationActiveInput,
  stockLocationActiveInputSchema,
  type StockLocationQuery,
  stockLocationQuerySchema,
  type StockLocationView,
  type StockMovementQuery,
  stockMovementQuerySchema,
  type StockMovementView,
  type StockReceiptInput,
  stockReceiptInputSchema,
  type StockReceiptView,
  type StockTransferCancelInput,
  stockTransferCancelInputSchema,
  type StockTransferInput,
  stockTransferInputSchema,
  stockTransferQuerySchema,
  type StockTransferView,
  type SupplierView,
} from '@simrs/shared';
import type { Response } from 'express';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { StockService } from './stock.service';

const uuid = new ParseUUIDPipe();

/**
 * S05 · Stok depo, B01 minimal (`/api/v1/stock`, rencana fase 4 §4.6a): lokasi, saldo per batch + ED, kartu stok,
 * penerimaan tanpa PO, mutasi dua langkah, penyesuaian beralasan. Izin `stock.*`; lingkup `unit` = lokasi stok unit
 * penugasan. Data stok tidak memuat PHI; setiap tulisan diaudit dan menerbitkan event domain `stock.*`.
 */
@ApiTags('penunjang · stok depo (S05)')
@TenantScoped()
@RequireModule('S05')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @RequirePermission('stock', 'read')
  @Get('locations')
  locations(
    @Query(new ZodValidationPipe(stockLocationQuerySchema)) q: StockLocationQuery,
  ): Promise<StockLocationView[]> {
    return this.stock.locations(q.purpose);
  }

  @RequirePermission('stock', 'receive')
  @Get('suppliers')
  suppliers(): Promise<SupplierView[]> {
    return this.stock.suppliers();
  }

  @RequirePermission('stock', 'receive')
  @Get('drugs')
  drugs(@Query(new ZodValidationPipe(stockDrugQuerySchema)) q: { q: string }): Promise<StockDrugView[]> {
    return this.stock.drugs(q.q);
  }

  @RequirePermission('stock', 'read')
  @Get('balances')
  balances(
    @Query(new ZodValidationPipe(stockBalanceQuerySchema)) q: StockBalanceQuery,
  ): Promise<StockBalance[]> {
    return this.stock.balances(q);
  }

  @RequirePermission('stock', 'read')
  @Get('movements')
  movements(
    @Query(new ZodValidationPipe(stockMovementQuerySchema)) q: StockMovementQuery,
  ): Promise<StockMovementView[]> {
    return this.stock.movements(q);
  }

  @RequirePermission('stock', 'read')
  @Get('transfers')
  transfers(
    @Query(new ZodValidationPipe(stockTransferQuerySchema)) q: { status?: StockTransferView['status'] },
  ): Promise<StockTransferView[]> {
    return this.stock.transfers(q.status);
  }

  /** Penerimaan barang. Header `Idempotency-Key` (UUID) wajib: 201 baru, 200 ulangan kunci + isi sama. */
  @RequirePermission('stock', 'receive')
  @Post('receipts')
  async receive(
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(stockReceiptInputSchema)) body: StockReceiptInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockReceiptView> {
    const r = await this.stock.receive(key, body);
    res.status(r.created ? 201 : 200);
    return r.view;
  }

  /** Mutasi langkah kirim. Header `Idempotency-Key` wajib. */
  @RequirePermission('stock', 'transfer')
  @Post('transfers')
  async sendTransfer(
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(stockTransferInputSchema)) body: StockTransferInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockTransferView> {
    const r = await this.stock.sendTransfer(key, body);
    res.status(r.created ? 201 : 200);
    return r.view;
  }

  /** Mutasi langkah terima di depo tujuan. Header `Idempotency-Key` wajib; ulangan kunci sama = hasil sama. */
  @RequirePermission('stock', 'transfer')
  @Post('transfers/:id/receive')
  @HttpCode(200)
  async receiveTransfer(
    @Headers('idempotency-key') key: string | undefined,
    @Param('id', uuid) id: string,
  ): Promise<StockTransferView> {
    return (await this.stock.receiveTransfer(key, id)).view;
  }

  /** Batalkan mutasi `dikirim` beralasan (petugas berlingkup depo asal); stok kembali ke depo asal. */
  @RequirePermission('stock', 'transfer')
  @Post('transfers/:id/cancel')
  @HttpCode(200)
  cancelTransfer(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(stockTransferCancelInputSchema)) body: StockTransferCancelInput,
  ): Promise<StockTransferView> {
    return this.stock.cancelTransfer(id, body.reason);
  }

  /** Penyesuaian beralasan. Header `Idempotency-Key` wajib. */
  @RequirePermission('stock', 'adjust')
  @Post('adjustments')
  async adjust(
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(stockAdjustmentInputSchema)) body: StockAdjustmentInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockAdjustmentView> {
    const r = await this.stock.adjust(key, body);
    res.status(r.created ? 201 : 200);
    return r.view;
  }

  /** Aktifkan/nonaktifkan lokasi stok (master struktur RS); lokasi dengan mutasi dalam perjalanan → 409. */
  @RequirePermission('facility', 'write')
  @Post('locations/:id/active')
  @HttpCode(200)
  setLocationActive(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(stockLocationActiveInputSchema)) body: StockLocationActiveInput,
  ): Promise<StockLocationView> {
    return this.stock.setLocationActive(id, body);
  }
}
