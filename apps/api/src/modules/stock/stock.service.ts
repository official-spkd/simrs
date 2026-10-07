import { Injectable } from '@nestjs/common';
import { knownDbError, Prisma, raisedDbCode, readTenantSetting, uniqueViolationTarget } from '@simrs/db';
import {
  AppError,
  batchExpired,
  batchExpiringSoon,
  isoDateJakarta,
  KFA_PATTERN,
  newId,
  type PermissionScope,
  type StockAdjustmentInput,
  type StockAdjustmentView,
  type StockBalance,
  type StockBalanceQuery,
  type StockDrugView,
  type StockLocationActiveInput,
  type StockLocationView,
  type StockMovementKind,
  type StockMovementQuery,
  type StockMovementView,
  type StockReceiptInput,
  type StockReceiptView,
  type StockTransferInput,
  type StockTransferView,
  type SupplierView,
  supportError,
} from '@simrs/shared';
import { type IdempotencyClaim, IdempotencyService } from '../../common/idempotency';
import { DomainEvents } from '../../infra/events/domain-events';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { NumberingService } from '../numbering/numbering.service';

type Tx = ReturnType<TenantDb['tx']>;

const LOCATION_SELECT = {
  id: true,
  code: true,
  name: true,
  kind: true,
  unitId: true,
  active: true,
  unit: { select: { id: true, name: true } },
} as const;

const BATCH_SELECT = {
  id: true,
  drugId: true,
  batchNo: true,
  expiryDate: true,
  unitCost: true,
  drug: { select: { name: true } },
} as const;

type BatchRow = Prisma.StockBatchGetPayload<{ select: typeof BATCH_SELECT }>;
type LocationRow = Prisma.StockLocationGetPayload<{ select: typeof LOCATION_SELECT }>;

/** Tanggal `@db.Date` (UTC tengah malam) → `YYYY-MM-DD`. */
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const kfaOf = (d: { codeSystem: string | null; code: string | null }) =>
  d.codeSystem === 'kfa' && d.code && KFA_PATTERN.test(d.code) ? d.code : null;

/**
 * Urutan kunci tetap (anti-deadlock): setiap tulisan saldo mengunci baris `stock_balances` lokasi × batch lewat trigger,
 * jadi beberapa baris dalam satu transaksi selalu ditulis urut `stockBatchId`. Tanpa ini dua mutasi/penyesuaian
 * serentak dengan item berurutan terbalik saling menunggu sampai Postgres membatalkan salah satunya (deadlock → 500).
 */
const byBatch = <T extends { stockBatchId: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.stockBatchId < b.stockBatchId ? -1 : a.stockBatchId > b.stockBatchId ? 1 : 0));

/** Deadlock / konflik serentak Postgres (Prisma P2034): transaksi dibatalkan utuh → `STOCK_CONFLICT` (409). */
function stockConflict(err: unknown, details: Record<string, unknown>): AppError | null {
  return knownDbError(err)?.code === 'P2034' ? supportError('STOCK_CONFLICT', details) : null;
}

/** Hasil tulisan ber-Idempotency-Key: `created` = baru (201), selain itu ulangan kunci + isi sama (200). */
export interface Written<T> {
  view: T;
  created: boolean;
}

/** Item transfer beku di `stock_transfers.items` (JSON). */
interface TransferItem {
  stockBatchId: string;
  quantity: number;
}

/**
 * S05 · Stok depo, B01 minimal (rencana fase 4 §4.6a, keputusan no. 9–10). Semua mutasi stok = baris ledger
 * `stock_movements` (append-only); saldo `stock_balances` hanya diubah trigger `app_stock_apply_movement` yang mengunci
 * baris saldo per lokasi × batch dan menolak saldo negatif (`STOCK_INSUFFICIENT`). Lingkup `unit` = lokasi stok
 * yang unitnya sama dengan unit penugasan sesi; lingkup `all` = semua lokasi RS. Batch kedaluwarsa tidak boleh diterima,
 * dimutasi, atau ditambah; hanya bisa dihapusbukukan lewat penyesuaian beralasan.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly db: TenantDb,
    private readonly numbering: NumberingService,
    private readonly events: DomainEvents,
    private readonly matrix: PermissionMatrix,
    private readonly idempotency: IdempotencyService,
  ) {}

  private tx(): Tx {
    return this.db.tx();
  }

  private me(): string {
    const id = this.db.actorUserId();
    if (!id) throw new AppError('FORBIDDEN', 'Stok hanya untuk staf yang masuk', 403);
    return id;
  }

  private today(): string {
    return isoDateJakarta();
  }

  /** Saringan lokasi untuk lingkup izin `scope` (lingkup `relationship` tidak bermakna untuk stok). */
  private locationWhere(scope: PermissionScope | null): Prisma.StockLocationWhereInput {
    if (scope === 'all') return {};
    const unitId = scope === 'unit' ? this.db.actor().unitId : null;
    return unitId ? { unitId } : { id: { in: [] } };
  }

  private inScope(loc: { unitId: string }, scope: PermissionScope | null): boolean {
    if (scope === 'all') return true;
    return scope === 'unit' && !!this.db.actor().unitId && this.db.actor().unitId === loc.unitId;
  }

  /** Lingkup sesi ini untuk aksi stok lain (mis. `transfer` saat membaca daftar mutasi). */
  private async scopeOf(action: string): Promise<PermissionScope | null> {
    const role = this.db.actor().role;
    if (!role) return null;
    return this.matrix.cache.scope(this.db.tenantId(), role, 'stock', action);
  }

  /** Lokasi stok aktif dalam lingkup endpoint ini; 404 bila tidak ada, 403 bila di luar lingkup. */
  private async location(id: string, scope = this.db.permissionScope()): Promise<LocationRow> {
    const loc = await this.tx().stockLocation.findUnique({ where: { id }, select: LOCATION_SELECT });
    if (!loc || !loc.active) throw new AppError('NOT_FOUND', 'Lokasi stok tidak ditemukan', 404);
    if (!this.inScope(loc, scope)) {
      throw new AppError('FORBIDDEN', `Anda tidak berwenang atas stok ${loc.name}`, 403);
    }
    return loc;
  }

  /** Tulis satu baris ledger; galat trigger dipetakan ke kode stabil (`STOCK_INSUFFICIENT`, `BATCH_EXPIRED`). */
  private async move(data: {
    stockLocationId: string;
    stockBatchId: string;
    kind: StockMovementKind;
    quantity: number;
    refType: string;
    refId: string;
    reason?: string | null;
    /** Harga pokok per satuan baris penerimaan (wajib untuk `receipt`). */
    unitCost?: bigint | null;
    detail?: Record<string, unknown>;
  }): Promise<string> {
    const id = newId();
    try {
      await this.tx().stockMovement.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          stockLocationId: data.stockLocationId,
          stockBatchId: data.stockBatchId,
          kind: data.kind,
          quantity: data.quantity,
          refType: data.refType,
          refId: data.refId,
          reason: data.reason ?? null,
          unitCost: data.unitCost ?? null,
          createdBy: this.me(),
        },
      });
    } catch (err) {
      const code = raisedDbCode(err);
      if (code === 'STOCK_INSUFFICIENT' || code === 'BATCH_EXPIRED') {
        throw supportError(code, { stockLocationId: data.stockLocationId, ...data.detail });
      }
      throw stockConflict(err, { stockLocationId: data.stockLocationId }) ?? err;
    }
    return id;
  }

  private async batches(ids: readonly string[]): Promise<Map<string, BatchRow>> {
    const rows = await this.tx().stockBatch.findMany({
      where: { id: { in: [...ids] } },
      select: BATCH_SELECT,
    });
    return new Map(rows.map((b) => [b.id, b]));
  }

  private batchOrThrow(map: Map<string, BatchRow>, id: string): BatchRow {
    const b = map.get(id);
    if (!b) throw new AppError('NOT_FOUND', 'Batch stok tidak ditemukan', 404, { stockBatchId: id });
    return b;
  }

  private docItem(b: BatchRow, quantity: number) {
    return {
      stockBatchId: b.id,
      drugId: b.drugId,
      drugName: b.drug.name,
      batchNo: b.batchNo,
      expiryDate: dateOnly(b.expiryDate),
      quantity,
    };
  }

  // ─── Baca ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** `own` = lokasi dalam lingkup sesi; `destination` = semua lokasi aktif sebagai tujuan mutasi. */
  async locations(purpose: 'own' | 'destination' = 'own'): Promise<StockLocationView[]> {
    const rows = await this.tx().stockLocation.findMany({
      where: {
        active: true,
        ...(purpose === 'own' ? this.locationWhere(this.db.permissionScope()) : {}),
      },
      select: LOCATION_SELECT,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      kind: l.kind as StockLocationView['kind'],
      unit: l.unit,
    }));
  }

  async suppliers(): Promise<SupplierView[]> {
    return this.tx().supplier.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async drugs(q: string): Promise<StockDrugView[]> {
    const term = q.trim();
    const rows = await this.tx().drug.findMany({
      where: {
        active: true,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { keywords: { contains: term, mode: 'insensitive' } },
                { code: term },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, codeSystem: true, code: true, highAlert: true },
      orderBy: { name: 'asc' },
      take: 30,
    });
    return rows.map((d) => ({ id: d.id, name: d.name, kfa: kfaOf(d), highAlert: d.highAlert }));
  }

  /** Saldo per lokasi × batch (qty > 0), urut obat lalu ED terdekat (FEFO). `expiring` = hanya ED dekat/lewat. */
  async balances(q: StockBalanceQuery): Promise<StockBalance[]> {
    const scope = this.db.permissionScope();
    if (q.stockLocationId) await this.location(q.stockLocationId);
    const warningDays = await readTenantSetting(this.tx(), 'stock.expiry_warning_days');
    const today = this.today();
    const rows = await this.tx().stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        ...(q.stockLocationId
          ? { stockLocationId: q.stockLocationId }
          : { stockLocation: { active: true, ...this.locationWhere(scope) } }),
      },
      select: {
        stockLocationId: true,
        stockBatchId: true,
        drugId: true,
        quantity: true,
        drug: { select: { name: true, codeSystem: true, code: true } },
        stockBatch: { select: { batchNo: true, expiryDate: true } },
      },
    });
    return rows
      .map((r) => {
        const expiryDate = dateOnly(r.stockBatch.expiryDate);
        return {
          stockLocationId: r.stockLocationId,
          drugId: r.drugId,
          drugName: r.drug.name,
          kfa: kfaOf(r.drug),
          stockBatchId: r.stockBatchId,
          batchNo: r.stockBatch.batchNo,
          expiryDate,
          quantity: r.quantity,
          expiringSoon: batchExpiringSoon(expiryDate, today, warningDays),
          expired: batchExpired(expiryDate, today),
        };
      })
      .filter((b) => q.expiring === '0' || b.expired || b.expiringSoon)
      .sort(
        (a, b) =>
          a.drugName.localeCompare(b.drugName, 'id') ||
          a.expiryDate.localeCompare(b.expiryDate) ||
          a.batchNo.localeCompare(b.batchNo),
      );
  }

  /** Kartu stok satu lokasi (opsional satu batch), terbaru dulu, dengan nomor dokumen rujukan. */
  async movements(q: StockMovementQuery): Promise<StockMovementView[]> {
    await this.location(q.stockLocationId);
    const rows = await this.tx().stockMovement.findMany({
      where: {
        stockLocationId: q.stockLocationId,
        ...(q.stockBatchId ? { stockBatchId: q.stockBatchId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      select: {
        id: true,
        createdAt: true,
        kind: true,
        quantity: true,
        stockLocationId: true,
        stockBatchId: true,
        refType: true,
        refId: true,
        reason: true,
        unitCost: true,
        stockBatch: { select: { batchNo: true, drug: { select: { name: true } } } },
        creator: { select: { id: true, displayName: true } },
      },
    });
    const refIds = (type: string) => rows.filter((r) => r.refType === type).map((r) => r.refId);
    const [receipts, transfers] = await Promise.all([
      this.tx().stockReceipt.findMany({
        where: { id: { in: refIds('stock_receipts') } },
        select: { id: true, receiptNo: true },
      }),
      this.tx().stockTransfer.findMany({
        where: { id: { in: refIds('stock_transfers') } },
        select: { id: true, transferNo: true },
      }),
    ]);
    const refNo = new Map<string, string>([
      ...receipts.map((r) => [r.id, r.receiptNo] as const),
      ...transfers.map((t) => [t.id, t.transferNo] as const),
    ]);
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      kind: r.kind as StockMovementKind,
      quantity: r.quantity,
      stockLocationId: r.stockLocationId,
      stockBatchId: r.stockBatchId,
      drugName: r.stockBatch.drug.name,
      batchNo: r.stockBatch.batchNo,
      refNo: refNo.get(r.refId) ?? null,
      refType: r.refType,
      reason: r.reason,
      unitCost: r.unitCost?.toString() ?? null,
      by: { userId: r.creator.id, nama: r.creator.displayName },
    }));
  }

  /** Mutasi yang menyentuh lokasi dalam lingkup (asal atau tujuan), terbaru dulu. */
  async transfers(status?: StockTransferView['status']): Promise<StockTransferView[]> {
    const where = this.locationWhere(this.db.permissionScope());
    const rows = await this.tx().stockTransfer.findMany({
      where: { ...(status ? { status } : {}), OR: [{ from: where }, { to: where }] },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { id: true },
    });
    const transferScope = await this.scopeOf('transfer');
    const out: StockTransferView[] = [];
    for (const r of rows) out.push(await this.transferView(r.id, transferScope));
    return out;
  }

  private async transferView(id: string, transferScope: PermissionScope | null): Promise<StockTransferView> {
    const t = await this.tx().stockTransfer.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        transferNo: true,
        status: true,
        items: true,
        sentAt: true,
        receivedAt: true,
        cancelledAt: true,
        cancelReason: true,
        from: { select: { id: true, name: true, unitId: true } },
        to: { select: { id: true, name: true, unitId: true } },
        sender: { select: { id: true, displayName: true } },
        receiver: { select: { id: true, displayName: true } },
        canceller: { select: { id: true, displayName: true } },
      },
    });
    const items = t.items as unknown as TransferItem[];
    const batches = await this.batches(items.map((i) => i.stockBatchId));
    return {
      id: t.id,
      transferNo: t.transferNo,
      status: t.status as StockTransferView['status'],
      from: { id: t.from.id, name: t.from.name },
      to: { id: t.to.id, name: t.to.name },
      items: items.map((i) => this.docItem(this.batchOrThrow(batches, i.stockBatchId), i.quantity)),
      sentAt: t.sentAt.toISOString(),
      sentBy: { userId: t.sender.id, nama: t.sender.displayName },
      receivedAt: t.receivedAt?.toISOString() ?? null,
      receivedBy: t.receiver ? { userId: t.receiver.id, nama: t.receiver.displayName } : null,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      cancelledBy: t.canceller ? { userId: t.canceller.id, nama: t.canceller.displayName } : null,
      cancelReason: t.cancelReason,
      canReceive: t.status === 'dikirim' && this.inScope(t.to, transferScope),
      canCancel: t.status === 'dikirim' && this.inScope(t.from, transferScope),
    };
  }

  // ─── Tulis ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Penerimaan barang tanpa PO: batch baru dibuat (ED, harga pokok, pemasok) atau batch yang sama dipakai ulang bila
   * nomor batch + ED cocok. Batch yang sudah kedaluwarsa ditolak (`BATCH_EXPIRED`).
   */
  async receive(rawKey: unknown, input: StockReceiptInput): Promise<Written<StockReceiptView>> {
    const claim = await this.idempotency.claim('stock.receipt', rawKey, input);
    if (claim.existingResourceId)
      return { view: await this.receiptView(claim.existingResourceId), created: false };
    return { view: await this.createReceipt(input, claim), created: true };
  }

  private async createReceipt(input: StockReceiptInput, claim: IdempotencyClaim): Promise<StockReceiptView> {
    const me = this.me();
    const loc = await this.location(input.stockLocationId);
    const supplier = await this.tx().supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, code: true, name: true, active: true },
    });
    if (!supplier?.active) throw new AppError('NOT_FOUND', 'Pemasok tidak ditemukan', 404);
    const today = this.today();
    const drugIds = [...new Set(input.items.map((i) => i.drugId))];
    const drugs = await this.tx().drug.findMany({
      where: { id: { in: drugIds }, active: true },
      select: { id: true },
    });
    if (drugs.length !== drugIds.length)
      throw new AppError('NOT_FOUND', 'Obat tidak ditemukan di formularium', 404);
    for (const [index, item] of input.items.entries()) {
      if (batchExpired(item.expiryDate, today)) {
        throw supportError(
          'BATCH_EXPIRED',
          { index, batchNo: item.batchNo, expiryDate: item.expiryDate },
          `Batch ${item.batchNo} sudah kedaluwarsa (${item.expiryDate}) dan tidak boleh diterima`,
        );
      }
    }

    // Satu faktur pemasok diterima sekali (indeks unik tenant × pemasok × nomor faktur); kunci menyerialkan dua
    // penerimaan serentak faktur yang sama dengan kunci idempotensi berbeda.
    const invoiceNo = input.invoiceNo.trim();
    await this.tx()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.db.tenantId()}:stock.invoice:${supplier.id}:${invoiceNo}`}, 0))`;
    const duplicate = await this.tx().stockReceipt.findUnique({
      where: {
        tenantId_supplierId_invoiceNo: { tenantId: this.db.tenantId(), supplierId: supplier.id, invoiceNo },
      },
      select: { receiptNo: true },
    });
    if (duplicate) throw this.invoiceTaken(invoiceNo, supplier.name, duplicate.receiptNo);
    const receiptId = newId();
    const { number: receiptNo } = await this.numbering.next('stock_receipt');
    try {
      await this.tx().stockReceipt.create({
        data: {
          id: receiptId,
          tenantId: this.db.tenantId(),
          receiptNo,
          stockLocationId: loc.id,
          supplierId: supplier.id,
          invoiceNo,
          receivedBy: me,
        },
      });
    } catch (err) {
      if (/invoice_no/.test(uniqueViolationTarget(err)))
        throw this.invoiceTaken(invoiceNo, supplier.name, null);
      throw err;
    }
    const movementIds: string[] = [];
    // Kunci per obat + nomor batch: dua penerimaan serentak batch yang sama tidak bentrok di indeks unik. Semua kunci
    // diambil di depan dalam urutan tetap (penerimaan multi-item dengan urutan berbeda tidak saling menunggu).
    const lockKeys = [
      ...new Set(input.items.map((i) => `${this.db.tenantId()}:stock.batch:${i.drugId}:${i.batchNo.trim()}`)),
    ].sort();
    for (const key of lockKeys) {
      await this.tx().$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    const lines: Array<{ batch: BatchRow; quantity: number; unitCost: bigint }> = [];
    for (const [index, item] of input.items.entries()) {
      const batchNo = item.batchNo.trim();
      let batch = await this.tx().stockBatch.findUnique({
        where: { tenantId_drugId_batchNo: { tenantId: this.db.tenantId(), drugId: item.drugId, batchNo } },
        select: BATCH_SELECT,
      });
      if (batch && dateOnly(batch.expiryDate) !== item.expiryDate) {
        throw new AppError(
          'CONFLICT',
          `Batch ${batchNo} sudah tercatat dengan ED ${dateOnly(batch.expiryDate)}; periksa nomor batch atau ED`,
          409,
          { index, batchNo },
        );
      }
      if (!batch) {
        batch = await this.tx().stockBatch.create({
          data: {
            id: newId(),
            tenantId: this.db.tenantId(),
            drugId: item.drugId,
            batchNo,
            expiryDate: new Date(`${item.expiryDate}T00:00:00Z`),
            unitCost: BigInt(item.unitCost),
            supplierId: supplier.id,
            createdBy: me,
          },
          select: BATCH_SELECT,
        });
      }
      lines.push({ batch, quantity: item.quantity, unitCost: BigInt(item.unitCost) });
    }
    for (const line of byBatch(lines.map((l) => ({ ...l, stockBatchId: l.batch.id })))) {
      movementIds.push(
        await this.move({
          stockLocationId: loc.id,
          stockBatchId: line.stockBatchId,
          kind: 'receipt',
          quantity: line.quantity,
          refType: 'stock_receipts',
          refId: receiptId,
          // Harga baris faktur; trigger ledger memperbarui harga pokok batch (rata-rata tertimbang).
          unitCost: line.unitCost,
        }),
      );
    }
    await this.events.publish('stock.received', {
      stockReceiptId: receiptId,
      stockLocationId: loc.id,
      stockMovementIds: movementIds,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'stock_receipt',
      resourceId: receiptId,
      details: { stockLocationId: loc.id, items: lines.length },
    });
    await this.idempotency.record(claim, 'stock_receipt', receiptId);
    return this.receiptView(receiptId);
  }

  private invoiceTaken(invoiceNo: string, supplierName: string, receiptNo: string | null): AppError {
    return new AppError(
      'CONFLICT',
      `Faktur ${invoiceNo} dari ${supplierName} sudah diterima${receiptNo ? ` (${receiptNo})` : ''}`,
      409,
      { invoiceNo, receiptNo },
    );
  }

  /** Dokumen penerimaan dari ledger: harga per baris (`unit_cost` baris receipt) + harga pokok batch kini. */
  private async receiptView(id: string): Promise<StockReceiptView> {
    const r = await this.tx().stockReceipt.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        receiptNo: true,
        stockLocationId: true,
        invoiceNo: true,
        receivedAt: true,
        supplier: { select: { id: true, code: true, name: true } },
        receiver: { select: { id: true, displayName: true } },
      },
    });
    const lines = await this.tx().stockMovement.findMany({
      where: { refType: 'stock_receipts', refId: id, kind: 'receipt' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { stockBatchId: true, quantity: true, unitCost: true },
    });
    const batches = await this.batches(lines.map((l) => l.stockBatchId));
    return {
      id: r.id,
      receiptNo: r.receiptNo,
      stockLocationId: r.stockLocationId,
      supplier: r.supplier,
      invoiceNo: r.invoiceNo,
      receivedAt: r.receivedAt.toISOString(),
      receivedBy: { userId: r.receiver.id, nama: r.receiver.displayName },
      items: lines.map((l) => {
        const b = this.batchOrThrow(batches, l.stockBatchId);
        return {
          ...this.docItem(b, l.quantity),
          unitCost: (l.unitCost ?? b.unitCost).toString(),
          batchUnitCost: b.unitCost.toString(),
        };
      }),
    };
  }

  /**
   * Mutasi langkah 1 (kirim): stok keluar dari depo asal (`transfer_out`) dan berstatus `dikirim` sampai diterima.
   * Selama di perjalanan stok tidak ada di kedua depo (tidak tergandakan). Batch kedaluwarsa tidak boleh dimutasi.
   */
  async sendTransfer(rawKey: unknown, input: StockTransferInput): Promise<Written<StockTransferView>> {
    const claim = await this.idempotency.claim('stock.transfer', rawKey, input);
    if (claim.existingResourceId) {
      return {
        view: await this.transferView(claim.existingResourceId, this.db.permissionScope()),
        created: false,
      };
    }
    return { view: await this.createTransfer(input, claim), created: true };
  }

  private async createTransfer(
    input: StockTransferInput,
    claim: IdempotencyClaim,
  ): Promise<StockTransferView> {
    const me = this.me();
    const from = await this.location(input.fromStockLocationId);
    const to = await this.tx().stockLocation.findUnique({
      where: { id: input.toStockLocationId },
      select: { id: true, active: true },
    });
    if (!to?.active) throw new AppError('NOT_FOUND', 'Depo tujuan tidak ditemukan', 404);
    const merged = new Map<string, number>();
    for (const i of input.items) merged.set(i.stockBatchId, (merged.get(i.stockBatchId) ?? 0) + i.quantity);
    const batches = await this.batches([...merged.keys()]);
    const today = this.today();
    for (const id of merged.keys()) {
      const b = this.batchOrThrow(batches, id);
      if (batchExpired(dateOnly(b.expiryDate), today)) {
        throw supportError(
          'BATCH_EXPIRED',
          { stockBatchId: id },
          `Batch ${b.batchNo} sudah kedaluwarsa dan tidak boleh dimutasi; hapus bukukan lewat penyesuaian`,
        );
      }
    }
    const transferId = newId();
    const { number: transferNo } = await this.numbering.next('stock_transfer');
    const items: TransferItem[] = byBatch(
      [...merged].map(([stockBatchId, quantity]) => ({ stockBatchId, quantity })),
    );
    await this.tx().stockTransfer.create({
      data: {
        id: transferId,
        tenantId: this.db.tenantId(),
        transferNo,
        fromStockLocationId: from.id,
        toStockLocationId: to.id,
        items: items as unknown as Prisma.InputJsonValue,
        sentBy: me,
      },
    });
    for (const i of items) {
      await this.move({
        stockLocationId: from.id,
        stockBatchId: i.stockBatchId,
        kind: 'transfer_out',
        quantity: -i.quantity,
        refType: 'stock_transfers',
        refId: transferId,
        detail: { stockBatchId: i.stockBatchId },
      });
    }
    await this.events.publish('stock.transferred', {
      stockTransferId: transferId,
      fromStockLocationId: from.id,
      toStockLocationId: to.id,
      stage: 'dikirim',
    });
    this.db.audit({ action: 'create', resourceType: 'stock_transfer', resourceId: transferId });
    await this.idempotency.record(claim, 'stock_transfer', transferId);
    return this.transferView(transferId, this.db.permissionScope());
  }

  /** Mutasi langkah 2 (terima) oleh petugas berlingkup atas depo tujuan; sekali saja (baris dikunci). */
  async receiveTransfer(rawKey: unknown, id: string): Promise<Written<StockTransferView>> {
    const claim = await this.idempotency.claim('stock.transfer.receive', rawKey, { stockTransferId: id });
    if (claim.existingResourceId) {
      return {
        view: await this.transferView(claim.existingResourceId, this.db.permissionScope()),
        created: false,
      };
    }
    const view = await this.acceptTransfer(id);
    await this.idempotency.record(claim, 'stock_transfer', id);
    return { view, created: true };
  }

  /** Kunci dokumen mutasi (penulis serentak antre di sini); deadlock/serialisasi Postgres → `STOCK_CONFLICT`. */
  private async lockTransfer(id: string) {
    try {
      await this.tx().$queryRaw`SELECT id FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE`;
    } catch (err) {
      throw stockConflict(err, { stockTransferId: id }) ?? err;
    }
    const t = await this.tx().stockTransfer.findUnique({
      where: { id },
      select: { id: true, status: true, items: true, fromStockLocationId: true, toStockLocationId: true },
    });
    if (!t) throw new AppError('NOT_FOUND', 'Mutasi stok tidak ditemukan', 404);
    return t;
  }

  private notInTransit(status: string): AppError {
    return new AppError(
      'CONFLICT',
      status === 'dibatalkan' ? 'Mutasi ini sudah dibatalkan' : 'Mutasi ini sudah diterima',
      409,
      { status },
    );
  }

  private async acceptTransfer(id: string): Promise<StockTransferView> {
    const me = this.me();
    // Dokumen mutasi dikunci lebih dulu (penerima serentak dokumen yang sama antre di sini → satu 200, sisanya 409),
    // lalu saldo depo tujuan ditulis urut batch.
    const t = await this.lockTransfer(id);
    const to = await this.location(t.toStockLocationId);
    if (t.status !== 'dikirim') throw this.notInTransit(t.status);
    for (const i of byBatch(t.items as unknown as TransferItem[])) {
      await this.move({
        stockLocationId: to.id,
        stockBatchId: i.stockBatchId,
        kind: 'transfer_in',
        quantity: i.quantity,
        refType: 'stock_transfers',
        refId: t.id,
      });
    }
    await this.tx().stockTransfer.update({
      where: { id },
      data: { status: 'diterima', receivedBy: me, receivedAt: new Date() },
    });
    await this.events.publish('stock.transferred', {
      stockTransferId: t.id,
      fromStockLocationId: t.fromStockLocationId,
      toStockLocationId: t.toStockLocationId,
      stage: 'diterima',
    });
    this.db.audit({
      action: 'update',
      resourceType: 'stock_transfer',
      resourceId: t.id,
      details: { stage: 'diterima' },
    });
    return this.transferView(t.id, this.db.permissionScope());
  }

  /**
   * Batalkan mutasi yang tersangkut `dikirim` (beralasan, sekali) oleh petugas berlingkup atas depo asal: stok kembali
   * ke depo asal lewat baris ledger pembalik (`transfer_in` di asal, beralasan), status `dibatalkan`.
   */
  async cancelTransfer(id: string, reason: string): Promise<StockTransferView> {
    const me = this.me();
    const t = await this.lockTransfer(id);
    const from = await this.location(t.fromStockLocationId);
    if (t.status !== 'dikirim') throw this.notInTransit(t.status);
    const why = reason.trim();
    for (const i of byBatch(t.items as unknown as TransferItem[])) {
      await this.move({
        stockLocationId: from.id,
        stockBatchId: i.stockBatchId,
        kind: 'transfer_in',
        quantity: i.quantity,
        refType: 'stock_transfers',
        refId: t.id,
        reason: `Pembatalan mutasi: ${why}`.slice(0, 500),
      });
    }
    try {
      await this.tx().stockTransfer.update({
        where: { id },
        data: { status: 'dibatalkan', cancelledBy: me, cancelReason: why },
      });
    } catch (err) {
      if (raisedDbCode(err) === 'CONFLICT') throw this.notInTransit('diterima');
      throw err;
    }
    await this.events.publish('stock.transferred', {
      stockTransferId: t.id,
      fromStockLocationId: t.fromStockLocationId,
      toStockLocationId: t.toStockLocationId,
      stage: 'dibatalkan',
    });
    this.db.audit({
      action: 'update',
      resourceType: 'stock_transfer',
      resourceId: t.id,
      reason: why,
      details: { stage: 'dibatalkan' },
    });
    return this.transferView(t.id, this.db.permissionScope());
  }

  /**
   * Aktifkan/nonaktifkan lokasi stok (izin `facility.write`). Lokasi yang masih punya mutasi `dikirim` (masuk atau
   * keluar) tidak bisa dinonaktifkan: dijaga trigger `stock_locations_transit_guard` → 409 `STOCK_LOCATION_IN_TRANSIT`.
   */
  async setLocationActive(id: string, input: StockLocationActiveInput): Promise<StockLocationView> {
    const me = this.me();
    const loc = await this.tx().stockLocation.findUnique({ where: { id }, select: LOCATION_SELECT });
    if (!loc) throw new AppError('NOT_FOUND', 'Lokasi stok tidak ditemukan', 404);
    try {
      await this.tx().stockLocation.update({
        where: { id },
        data: { active: input.active, updatedBy: me },
      });
    } catch (err) {
      if (raisedDbCode(err) === 'STOCK_LOCATION_IN_TRANSIT') {
        throw supportError('STOCK_LOCATION_IN_TRANSIT', { stockLocationId: id });
      }
      throw err;
    }
    this.db.audit({
      action: 'update',
      resourceType: 'stock_location',
      resourceId: id,
      details: { active: input.active },
    });
    return {
      id: loc.id,
      code: loc.code,
      name: loc.name,
      kind: loc.kind as StockLocationView['kind'],
      unit: loc.unit,
    };
  }

  /**
   * Penyesuaian stok beralasan (opname, rusak, hilang, hapus buku kedaluwarsa). Selisih negatif tidak boleh melebihi
   * saldo (`STOCK_INSUFFICIENT`); batch kedaluwarsa hanya boleh dikurangi (hapus buku `write_off`).
   */
  async adjust(rawKey: unknown, input: StockAdjustmentInput): Promise<Written<StockAdjustmentView>> {
    const claim = await this.idempotency.claim('stock.adjustment', rawKey, input);
    if (claim.existingResourceId) {
      return { view: await this.adjustmentView(claim.existingResourceId), created: false };
    }
    return { view: await this.createAdjustment(input, claim), created: true };
  }

  private async createAdjustment(
    input: StockAdjustmentInput,
    claim: IdempotencyClaim,
  ): Promise<StockAdjustmentView> {
    const me = this.me();
    const loc = await this.location(input.stockLocationId);
    const batches = await this.batches(input.items.map((i) => i.stockBatchId));
    const today = this.today();
    const adjustmentId = newId();
    await this.tx().stockAdjustment.create({
      data: {
        id: adjustmentId,
        tenantId: this.db.tenantId(),
        stockLocationId: loc.id,
        reason: input.reason,
        adjustedBy: me,
      },
    });
    const movementIds: string[] = [];
    for (const item of byBatch(input.items)) {
      const b = this.batchOrThrow(batches, item.stockBatchId);
      const expired = batchExpired(dateOnly(b.expiryDate), today);
      if (expired && item.quantityDelta > 0) {
        throw supportError(
          'BATCH_EXPIRED',
          { stockBatchId: b.id },
          `Batch ${b.batchNo} sudah kedaluwarsa; stoknya tidak boleh ditambah`,
        );
      }
      movementIds.push(
        await this.move({
          stockLocationId: loc.id,
          stockBatchId: b.id,
          kind: expired ? 'write_off' : 'adjustment',
          quantity: item.quantityDelta,
          refType: 'stock_adjustments',
          refId: adjustmentId,
          reason: input.reason,
          detail: { stockBatchId: b.id },
        }),
      );
    }
    await this.events.publish('stock.adjusted', {
      stockAdjustmentId: adjustmentId,
      stockLocationId: loc.id,
      stockMovementIds: movementIds,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'stock_adjustment',
      resourceId: adjustmentId,
      reason: input.reason,
      details: { stockLocationId: loc.id, items: input.items.length },
    });
    await this.idempotency.record(claim, 'stock_adjustment', adjustmentId);
    return this.adjustmentView(adjustmentId);
  }

  private async adjustmentView(id: string): Promise<StockAdjustmentView> {
    const a = await this.tx().stockAdjustment.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        stockLocationId: true,
        reason: true,
        adjustedAt: true,
        adjuster: { select: { id: true, displayName: true } },
      },
    });
    const lines = await this.tx().stockMovement.findMany({
      where: { refType: 'stock_adjustments', refId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { stockBatchId: true, quantity: true },
    });
    const batches = await this.batches(lines.map((l) => l.stockBatchId));
    return {
      id: a.id,
      stockLocationId: a.stockLocationId,
      reason: a.reason,
      adjustedAt: a.adjustedAt.toISOString(),
      adjustedBy: { userId: a.adjuster.id, nama: a.adjuster.displayName },
      items: lines.map((l) => this.docItem(this.batchOrThrow(batches, l.stockBatchId), l.quantity)),
    };
  }
}
