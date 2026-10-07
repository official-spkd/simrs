import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
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
  type StockLocationView,
  type StockMovementQuery,
  stockMovementQuerySchema,
  type StockMovementView,
  type StockReceiptInput,
  stockReceiptInputSchema,
  type StockReceiptView,
  type StockTransferInput,
  stockTransferInputSchema,
  stockTransferQuerySchema,
  type StockTransferView,
  type SupplierView,
} from '@simrs/shared';
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
  locations(): Promise<StockLocationView[]> {
    return this.stock.locations();
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
    @Query(new ZodValidationPipe(stockTransferQuerySchema)) q: { status?: 'dikirim' | 'diterima' },
  ): Promise<StockTransferView[]> {
    return this.stock.transfers(q.status);
  }

  @RequirePermission('stock', 'receive')
  @Post('receipts')
  receive(
    @Body(new ZodValidationPipe(stockReceiptInputSchema)) body: StockReceiptInput,
  ): Promise<StockReceiptView> {
    return this.stock.receive(body);
  }

  @RequirePermission('stock', 'transfer')
  @Post('transfers')
  sendTransfer(
    @Body(new ZodValidationPipe(stockTransferInputSchema)) body: StockTransferInput,
  ): Promise<StockTransferView> {
    return this.stock.sendTransfer(body);
  }

  @RequirePermission('stock', 'transfer')
  @Post('transfers/:id/receive')
  @HttpCode(200)
  receiveTransfer(@Param('id', uuid) id: string): Promise<StockTransferView> {
    return this.stock.receiveTransfer(id);
  }

  @RequirePermission('stock', 'adjust')
  @Post('adjustments')
  adjust(
    @Body(new ZodValidationPipe(stockAdjustmentInputSchema)) body: StockAdjustmentInput,
  ): Promise<StockAdjustmentView> {
    return this.stock.adjust(body);
  }
}
