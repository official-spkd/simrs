import { Injectable } from '@nestjs/common';
import { knownDbError, raisedDbCode } from '@simrs/db';
import {
  AppError,
  batchExpired,
  DISPENSE_LABEL_PATTERN,
  dispenseDoubleCheckBlock,
  type DispenseHandoverInput,
  type DispenseLabelView,
  type DispensePrepareInput,
  type DispenseReturnInput,
  type DispenseView,
  handoverBlock,
  isoDateJakarta,
  manualBatchBlock,
  type MedicationRequestView,
  newId,
  pickFefo,
  supportError,
} from '@simrs/shared';
import { type IdempotencyClaim, IdempotencyService } from '../../common/idempotency';
import { BillableRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { OrdersView } from '../orders/orders-view';
import { PharmacyClinicalService } from '../pharmacy-clinical/pharmacy-clinical.service';

type Tx = ReturnType<TenantDb['tx']>;

/** Hasil tulisan ber-Idempotency-Key: `created` = baru (201), selain itu ulangan kunci + isi sama (200). */
export interface Written<T> {
  view: T;
  created: boolean;
}

interface Line {
  medicationRequestId: string;
  stockBatchId: string;
  quantity: number;
  fefoOverrideReason: string | null;
}

/** Urutan kunci baris saldo deterministik (sama dengan modul stok) agar tidak deadlock dengan mutasi serentak. */
const byBatch = <T extends { stockBatchId: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.stockBatchId < b.stockBatchId ? -1 : a.stockBatchId > b.stockBatchId ? 1 : 0));

/** Label dosis farmasi `OBT-XXXXXXXXXXXX` dari 12 karakter acak terakhir id item. */
const labelOf = (dispenseItemId: string) =>
  `OBT-${dispenseItemId.replace(/-/g, '').slice(-12).toUpperCase()}`;

const DISPENSE_SELECT = {
  id: true,
  pharmacyPrescriptionId: true,
  encounterId: true,
  patientId: true,
  stockLocationId: true,
  preparedBy: true,
  hasHighAlert: true,
  doubleCheckedBy: true,
  handedOverAt: true,
} as const;

/**
 * S05 · Dispensing (rencana fase 4 §4.6b): penyiapan FEFO dari ledger stok (pengeluaran `dispense` di transaksi yang
 * sama, kunci batch berurutan), label dosis per batch untuk eMAR (F3-5), cek ganda apoteker kedua dari sesinya sendiri,
 * serah terima (titik tagih obat, keputusan fase 4 no. 11), dan retur (layak kembali ke stok, tidak layak dicatat).
 * Lingkup `unit` = depo yang unitnya sama dengan unit penugasan; retur perawat (`relationship`) lewat ABAC pasien.
 */
@Injectable()
export class DispensingService {
  constructor(
    private readonly db: TenantDb,
    private readonly idempotency: IdempotencyService,
    private readonly events: DomainEvents,
    private readonly billable: BillableRecorder,
    private readonly access: PatientAccessService,
    private readonly orders: OrdersView,
    private readonly pharmacy: PharmacyClinicalService,
  ) {}

  private tx(): Tx {
    return this.db.tx();
  }

  private me(): string {
    const id = this.db.actorUserId();
    if (!id) throw new AppError('FORBIDDEN', 'Dispensing hanya untuk staf yang masuk', 403);
    return id;
  }

  /** Lingkup sesi atas depo: `all` semua; `unit` depo unit penugasan; `relationship` lewat ABAC pasien. */
  private async assertScope(location: { unitId: string; name: string }, patientId: string): Promise<void> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return;
    if (scope === 'unit') {
      if (this.db.actor().unitId !== location.unitId) {
        throw new AppError('FORBIDDEN', `Resep ini dilayani ${location.name}, di luar unit Anda`, 403);
      }
      return;
    }
    await this.access.assert(patientId);
  }

  private async prescription(id: string) {
    await this.tx().$queryRaw`SELECT id FROM pharmacy_prescriptions WHERE id = ${id}::uuid FOR UPDATE`;
    const p = await this.tx().pharmacyPrescription.findUnique({
      where: { id },
      select: {
        id: true,
        prescriptionNo: true,
        orderGroupId: true,
        encounterId: true,
        patientId: true,
        status: true,
        stockLocation: { select: { id: true, name: true, unitId: true } },
        reviews: {
          orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { decision: true, medicationRequestIds: true },
        },
      },
    });
    if (!p) throw new AppError('NOT_FOUND', 'Resep farmasi tidak ditemukan', 404);
    await this.assertScope(p.stockLocation, p.patientId);
    return p;
  }

  /** Kunci baris penyiapan; resep dan depo ikut untuk lingkup dan event. */
  private async dispenseRow(id: string) {
    await this.tx().$queryRaw`SELECT id FROM dispenses WHERE id = ${id}::uuid FOR UPDATE`;
    const d = await this.tx().dispense.findUnique({
      where: { id },
      select: {
        ...DISPENSE_SELECT,
        prescription: {
          select: {
            id: true,
            status: true,
            prescriptionNo: true,
            stockLocation: { select: { id: true, name: true, unitId: true } },
          },
        },
        items: { select: { id: true, quantity: true, stockBatchId: true, medicationRequestId: true } },
      },
    });
    if (!d) throw new AppError('NOT_FOUND', 'Penyiapan obat tidak ditemukan', 404);
    await this.assertScope(d.prescription.stockLocation, d.patientId);
    return d;
  }

  // ─── Penyiapan ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Siapkan obat resep yang lolos telaah (`penyiapan`): batch FEFO otomatis per item (dipecah lintas batch bila
   * perlu) atau batch pilihan beralasan; ledger `dispense` + item + label dosis di transaksi yang sama; resep → `serah`.
   */
  async prepare(
    rawKey: unknown,
    prescriptionId: string,
    input: DispensePrepareInput,
  ): Promise<Written<DispenseView>> {
    const claim = await this.idempotency.claim('dispensing.prepare', rawKey, { prescriptionId, ...input });
    if (claim.existingResourceId) return { view: await this.view(claim.existingResourceId), created: false };
    return { view: await this.createDispense(prescriptionId, input, claim), created: true };
  }

  private async createDispense(
    prescriptionId: string,
    input: DispensePrepareInput,
    claim: IdempotencyClaim,
  ): Promise<DispenseView> {
    const me = this.me();
    const p = await this.prescription(prescriptionId);
    if (p.status !== 'penyiapan') {
      throw new AppError(
        'CONFLICT',
        `Resep ${p.prescriptionNo} berstatus ${p.status}; hanya resep yang lolos telaah yang disiapkan`,
        409,
        { status: p.status },
      );
    }
    const group = await this.orders.group(p.orderGroupId);
    if (!group) throw new AppError('NOT_FOUND', 'Kiriman order tidak ditemukan', 404);
    const review = p.reviews[0];
    const approved = new Set(
      review?.decision === 'sebagian'
        ? review.medicationRequestIds
        : group.medicationRequests.filter((m) => m.status === 'aktif').map((m) => m.id),
    );
    const meds = new Map<string, MedicationRequestView>(group.medicationRequests.map((m) => [m.id, m]));
    const seen = new Set<string>();
    for (const item of input.items) {
      const med = meds.get(item.medicationRequestId);
      if (!med || !approved.has(med.id) || med.status !== 'aktif') {
        throw new AppError(
          'VALIDATION_FAILED',
          'Item harus obat aktif yang disetujui pada telaah resep ini',
          400,
        );
      }
      if (seen.has(med.id)) throw new AppError('VALIDATION_FAILED', `${med.name} tercantum dua kali`, 400);
      seen.add(med.id);
      if (!med.drugId) {
        // ASUMSI 4.6b: racikan (multi-komponen) belum dikeluarkan lewat ledger per komponen; disiapkan manual.
        throw new AppError(
          'VALIDATION_FAILED',
          `${med.name} adalah racikan; penyiapan racikan belum didukung`,
          422,
        );
      }
    }

    const loc = p.stockLocation;
    const today = isoDateJakarta();
    const drugIds = input.items.map((i) => meds.get(i.medicationRequestId)?.drugId as string);
    const balances = await this.tx().stockBalance.findMany({
      where: { stockLocationId: loc.id, drugId: { in: drugIds }, quantity: { gt: 0 } },
      select: {
        drugId: true,
        quantity: true,
        stockBatchId: true,
        stockBatch: { select: { expiryDate: true, batchNo: true } },
      },
    });
    const lines: Line[] = [];
    for (const item of input.items) {
      const med = meds.get(item.medicationRequestId) as MedicationRequestView;
      const mine = balances
        .filter((b) => b.drugId === med.drugId)
        .map((b) => ({
          id: b.stockBatchId,
          expiryDate: b.stockBatch.expiryDate.toISOString().slice(0, 10),
          quantity: b.quantity,
        }));
      if (item.stockBatchId === null) {
        const fefo = pickFefo(mine, item.quantity, today);
        if (!fefo.ok) {
          throw supportError(fefo.code, { medicationRequestId: med.id, stockLocationId: loc.id });
        }
        for (const pick of fefo.picks) {
          lines.push({
            medicationRequestId: med.id,
            stockBatchId: pick.batchId,
            quantity: pick.quantity,
            fefoOverrideReason: null,
          });
        }
        continue;
      }
      const batch =
        mine.find((b) => b.id === item.stockBatchId) ??
        (await this.batchOf(item.stockBatchId, med.drugId as string));
      const block = manualBatchBlock(batch, item.quantity, today);
      if (block) throw supportError(block, { medicationRequestId: med.id, stockBatchId: batch.id });
      lines.push({
        medicationRequestId: med.id,
        stockBatchId: batch.id,
        quantity: item.quantity,
        fefoOverrideReason: item.fefoOverrideReason?.trim() ?? null,
      });
    }

    const dispenseId = newId();
    const hasHighAlert = input.items.some((i) => meds.get(i.medicationRequestId)?.highAlert);
    await this.tx().dispense.create({
      data: {
        id: dispenseId,
        tenantId: this.db.tenantId(),
        pharmacyPrescriptionId: p.id,
        encounterId: p.encounterId,
        patientId: p.patientId,
        stockLocationId: loc.id,
        preparedBy: me,
        hasHighAlert,
      },
    });
    for (const line of byBatch(lines)) {
      const movementId = newId();
      try {
        await this.tx().stockMovement.create({
          data: {
            id: movementId,
            tenantId: this.db.tenantId(),
            stockLocationId: loc.id,
            stockBatchId: line.stockBatchId,
            kind: 'dispense',
            quantity: -line.quantity,
            refType: 'dispenses',
            refId: dispenseId,
            reason: line.fefoOverrideReason,
            encounterId: p.encounterId,
            patientId: p.patientId,
            createdBy: me,
          },
        });
      } catch (err) {
        const code = raisedDbCode(err);
        if (code === 'STOCK_INSUFFICIENT' || code === 'BATCH_EXPIRED') {
          throw supportError(code, { stockLocationId: loc.id, stockBatchId: line.stockBatchId });
        }
        if (knownDbError(err)?.code === 'P2034')
          throw supportError('STOCK_CONFLICT', { stockLocationId: loc.id });
        throw err;
      }
      const itemId = newId();
      await this.tx().dispenseItem.create({
        data: {
          id: itemId,
          tenantId: this.db.tenantId(),
          dispenseId,
          medicationRequestId: line.medicationRequestId,
          stockBatchId: line.stockBatchId,
          quantity: line.quantity,
          labelBarcode: labelOf(itemId),
          fefoOverrideReason: line.fefoOverrideReason,
          stockMovementId: movementId,
        },
      });
    }
    await this.pharmacy.setStatus(p.id, p.status, 'serah', null);
    await this.idempotency.record(claim, 'dispense', dispenseId);
    this.db.audit({
      action: 'create',
      resourceType: 'dispense',
      resourceId: dispenseId,
      patientId: p.patientId,
      details: {
        pharmacyPrescriptionId: p.id,
        stockLocationId: loc.id,
        lines: lines.length,
        fefoOverrides: lines.filter((l) => l.fefoOverrideReason).length,
      },
    });
    return this.view(dispenseId);
  }

  /** Batch pilihan manual yang tidak bersaldo di depo ini (saldo 0) tetap dinilai: ED dulu, lalu saldo. */
  private async batchOf(stockBatchId: string, drugId: string) {
    const b = await this.tx().stockBatch.findUnique({
      where: { id: stockBatchId },
      select: { id: true, drugId: true, expiryDate: true },
    });
    if (!b || b.drugId !== drugId) {
      throw new AppError('VALIDATION_FAILED', 'Batch pilihan bukan batch obat item ini', 400);
    }
    return { id: b.id, expiryDate: b.expiryDate.toISOString().slice(0, 10), quantity: 0 };
  }

  // ─── Cek ganda dan serah terima ──────────────────────────────────────────────────────────────────────────────

  /** Cek ganda oleh apoteker LAIN dari sesinya sendiri (keputusan fase 4 no. 12); sekali per penyiapan. */
  async doubleCheck(dispenseId: string): Promise<DispenseView> {
    const me = this.me();
    const d = await this.dispenseRow(dispenseId);
    if (d.handedOverAt) throw new AppError('CONFLICT', 'Obat sudah diserahkan', 409);
    if (d.doubleCheckedBy) throw new AppError('CONFLICT', 'Penyiapan ini sudah dicek ganda', 409);
    const block = dispenseDoubleCheckBlock({ preparedBy: d.preparedBy, checkerUserId: me });
    if (block) throw supportError(block, { dispenseId });
    await this.tx().dispense.update({
      where: { id: d.id },
      data: { doubleCheckedBy: me, doubleCheckedAt: new Date() },
    });
    this.db.audit({
      action: 'verify',
      resourceType: 'dispense',
      resourceId: d.id,
      patientId: d.patientId,
      details: { doubleCheck: true, hasHighAlert: d.hasHighAlert },
    });
    return this.view(d.id);
  }

  /**
   * Serah terima: penerima + nama + PIO. Obat kewaspadaan tinggi tanpa cek ganda → 409. Titik tagih obat: satu
   * peristiwa biaya `obat` per item (tanpa harga, ADR-0032), event `pharmacy.dispensed`, resep → `selesai`.
   */
  async handover(dispenseId: string, input: DispenseHandoverInput): Promise<DispenseView> {
    const me = this.me();
    const d = await this.dispenseRow(dispenseId);
    if (d.handedOverAt) throw new AppError('CONFLICT', 'Obat sudah diserahkan', 409);
    const block = handoverBlock({ hasHighAlert: d.hasHighAlert, doubleChecked: d.doubleCheckedBy !== null });
    if (block) throw supportError(block, { dispenseId });
    const at = new Date();
    await this.tx().dispense.update({
      where: { id: d.id },
      data: {
        handedOverBy: me,
        handedOverAt: at,
        receiverKind: input.receiverKind,
        receiverName: input.receiverName.trim(),
        counselingGiven: input.counselingGiven,
      },
    });
    for (const item of d.items) {
      await this.billable.record({
        encounterId: d.encounterId,
        patientId: d.patientId,
        sourceType: 'dispense_items',
        sourceId: item.id,
        kind: 'obat',
        quantity: Math.min(item.quantity, 1000),
        occurredAt: at,
      });
    }
    if (d.prescription.status === 'serah') {
      await this.pharmacy.setStatus(d.prescription.id, 'serah', 'selesai', null);
    }
    await this.events.publish('pharmacy.dispensed', {
      dispenseId: d.id,
      pharmacyPrescriptionId: d.prescription.id,
      encounterId: d.encounterId,
      patientId: d.patientId,
      unitId: d.prescription.stockLocation.unitId,
      dispenseItemIds: d.items.map((i) => i.id),
    });
    this.db.audit({
      action: 'update',
      resourceType: 'dispense',
      resourceId: d.id,
      patientId: d.patientId,
      details: { handover: input.receiverKind, items: d.items.length },
    });
    return this.view(d.id);
  }

  // ─── Retur ───────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Retur obat yang sudah diserahkan. Layak (batch belum kedaluwarsa) → ledger `return` ke depo asal; tidak layak →
   * dicatat tanpa saldo masuk (obat sudah keluar dari stok saat penyerahan). Tiap baris menerbitkan `pharmacy.returned`
   * (kredit tagihan fase 5). Jumlah retur tidak melebihi sisa yang diserahkan.
   */
  async returns(
    rawKey: unknown,
    dispenseId: string,
    input: DispenseReturnInput,
  ): Promise<Written<DispenseView>> {
    const claim = await this.idempotency.claim('dispensing.return', rawKey, { dispenseId, ...input });
    if (claim.existingResourceId) return { view: await this.view(claim.existingResourceId), created: false };
    const me = this.me();
    const d = await this.dispenseRow(dispenseId);
    if (!d.handedOverAt)
      throw new AppError('CONFLICT', 'Obat belum diserahkan; retur hanya setelah serah terima', 409);
    const items = new Map(d.items.map((i) => [i.id, i]));
    const already = await this.tx().dispenseReturn.groupBy({
      by: ['dispenseItemId'],
      where: { dispenseItemId: { in: [...items.keys()] } },
      _sum: { quantity: true },
    });
    const returned = new Map(already.map((r) => [r.dispenseItemId, r._sum.quantity ?? 0]));
    const asked = new Map<string, number>();
    for (const r of input.items) {
      const item = items.get(r.dispenseItemId);
      if (!item) throw new AppError('VALIDATION_FAILED', 'Item retur bukan item penyiapan ini', 400);
      asked.set(item.id, (asked.get(item.id) ?? 0) + r.quantity);
      if ((returned.get(item.id) ?? 0) + (asked.get(item.id) ?? 0) > item.quantity) {
        throw new AppError('CONFLICT', 'Jumlah retur melebihi jumlah yang diserahkan', 409, {
          dispenseItemId: item.id,
        });
      }
    }
    const batches = await this.tx().stockBatch.findMany({
      where: { id: { in: d.items.map((i) => i.stockBatchId) } },
      select: { id: true, expiryDate: true },
    });
    const expiry = new Map(batches.map((b) => [b.id, b.expiryDate.toISOString().slice(0, 10)]));
    const today = isoDateJakarta();
    const rows = byBatch(
      input.items.map((r) => ({
        ...r,
        stockBatchId: (items.get(r.dispenseItemId) as { stockBatchId: string }).stockBatchId,
      })),
    );
    for (const r of rows) {
      let movementId: string | null = null;
      if (r.condition === 'layak') {
        if (batchExpired(expiry.get(r.stockBatchId) ?? '0000-01-01', today)) {
          throw supportError(
            'BATCH_EXPIRED',
            { dispenseItemId: r.dispenseItemId },
            'Batch sudah kedaluwarsa; retur hanya bisa dicatat tidak layak',
          );
        }
        movementId = newId();
        try {
          await this.tx().stockMovement.create({
            data: {
              id: movementId,
              tenantId: this.db.tenantId(),
              stockLocationId: d.stockLocationId,
              stockBatchId: r.stockBatchId,
              kind: 'return',
              quantity: r.quantity,
              refType: 'dispenses',
              refId: d.id,
              reason: input.reason.trim(),
              encounterId: d.encounterId,
              patientId: d.patientId,
              createdBy: me,
            },
          });
        } catch (err) {
          if (knownDbError(err)?.code === 'P2034') {
            throw supportError('STOCK_CONFLICT', { stockLocationId: d.stockLocationId });
          }
          throw err;
        }
      }
      const returnId = newId();
      await this.tx().dispenseReturn.create({
        data: {
          id: returnId,
          tenantId: this.db.tenantId(),
          dispenseItemId: r.dispenseItemId,
          quantity: r.quantity,
          condition: r.condition,
          reason: input.reason.trim(),
          stockMovementId: movementId,
          returnedBy: me,
        },
      });
      await this.events.publish('pharmacy.returned', {
        dispenseReturnId: returnId,
        dispenseId: d.id,
        encounterId: d.encounterId,
        patientId: d.patientId,
        unitId: d.prescription.stockLocation.unitId,
        restocked: movementId !== null,
      });
    }
    await this.idempotency.record(claim, 'dispense', d.id);
    this.db.audit({
      action: 'create',
      resourceType: 'dispense_return',
      resourceId: d.id,
      patientId: d.patientId,
      reason: input.reason,
      details: {
        items: input.items.length,
        restocked: input.items.filter((i) => i.condition === 'layak').length,
      },
    });
    return { view: await this.view(d.id), created: true };
  }

  // ─── Baca ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Penyiapan satu resep (lingkup depo), terbaru dulu. */
  async forPrescription(prescriptionId: string): Promise<DispenseView[]> {
    const p = await this.tx().pharmacyPrescription.findUnique({
      where: { id: prescriptionId },
      select: { patientId: true, stockLocation: { select: { name: true, unitId: true } } },
    });
    if (!p) throw new AppError('NOT_FOUND', 'Resep farmasi tidak ditemukan', 404);
    await this.assertScope(p.stockLocation, p.patientId);
    const rows = await this.tx().dispense.findMany({
      where: { pharmacyPrescriptionId: prescriptionId },
      orderBy: [{ preparedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.view(r.id)));
  }

  async viewScoped(dispenseId: string): Promise<DispenseView> {
    const d = await this.tx().dispense.findUnique({
      where: { id: dispenseId },
      select: {
        patientId: true,
        prescription: { select: { stockLocation: { select: { name: true, unitId: true } } } },
      },
    });
    if (!d) throw new AppError('NOT_FOUND', 'Penyiapan obat tidak ditemukan', 404);
    await this.assertScope(d.prescription.stockLocation, d.patientId);
    return this.view(dispenseId);
  }

  async view(dispenseId: string): Promise<DispenseView> {
    const d = await this.tx().dispense.findUniqueOrThrow({
      where: { id: dispenseId },
      select: {
        id: true,
        pharmacyPrescriptionId: true,
        preparedAt: true,
        hasHighAlert: true,
        doubleCheckedAt: true,
        handedOverAt: true,
        receiverKind: true,
        receiverName: true,
        counselingGiven: true,
        prescription: {
          select: { prescriptionNo: true, stockLocation: { select: { id: true, name: true } } },
        },
        patient: { select: { id: true, name: true, mrn: true } },
        encounter: { select: { id: true, number: true } },
        preparer: { select: { id: true, displayName: true } },
        doubleChecker: { select: { id: true, displayName: true } },
        handedOverByU: { select: { id: true, displayName: true } },
        items: {
          orderBy: [{ medicationRequestId: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            medicationRequestId: true,
            quantity: true,
            labelBarcode: true,
            fefoOverrideReason: true,
            stockBatchId: true,
            stockBatch: { select: { batchNo: true, expiryDate: true, drug: { select: { name: true } } } },
            medicationRequest: { select: { highAlert: true } },
            returns: {
              orderBy: [{ returnedAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                dispenseItemId: true,
                quantity: true,
                condition: true,
                reason: true,
                stockMovementId: true,
                returnedAt: true,
                returner: { select: { id: true, displayName: true } },
              },
            },
          },
        },
      },
    });
    const person = (u: { id: string; displayName: string }) => ({ userId: u.id, nama: u.displayName });
    return {
      id: d.id,
      pharmacyPrescriptionId: d.pharmacyPrescriptionId,
      prescriptionNo: d.prescription.prescriptionNo,
      stockLocation: d.prescription.stockLocation,
      patient: d.patient,
      encounter: d.encounter,
      preparedBy: person(d.preparer),
      preparedAt: d.preparedAt.toISOString(),
      hasHighAlert: d.hasHighAlert,
      doubleCheck:
        d.doubleChecker && d.doubleCheckedAt
          ? { by: person(d.doubleChecker), at: d.doubleCheckedAt.toISOString() }
          : null,
      handover:
        d.handedOverByU && d.handedOverAt
          ? {
              by: person(d.handedOverByU),
              at: d.handedOverAt.toISOString(),
              receiverKind: d.receiverKind as 'pasien' | 'keluarga' | 'perawat',
              receiverName: d.receiverName ?? '',
              counselingGiven: d.counselingGiven,
            }
          : null,
      items: d.items.map((i) => ({
        id: i.id,
        medicationRequestId: i.medicationRequestId,
        drugName: i.stockBatch.drug.name,
        stockBatchId: i.stockBatchId,
        batchNo: i.stockBatch.batchNo,
        expiryDate: i.stockBatch.expiryDate.toISOString().slice(0, 10),
        quantity: i.quantity,
        labelBarcode: i.labelBarcode,
        fefoOverrideReason: i.fefoOverrideReason,
        highAlert: i.medicationRequest.highAlert,
        returned: i.returns.reduce((s, r) => s + r.quantity, 0),
      })),
      returns: d.items.flatMap((i) =>
        i.returns.map((r) => ({
          id: r.id,
          dispenseItemId: r.dispenseItemId,
          quantity: r.quantity,
          condition: r.condition as 'layak' | 'tidak_layak',
          reason: r.reason,
          restocked: r.stockMovementId !== null,
          by: person(r.returner),
          at: r.returnedAt.toISOString(),
        })),
      ),
    };
  }

  // ─── Label untuk eMAR (F3-5) ─────────────────────────────────────────────────────────────────────────────────

  /** Data etiket dari barcode label farmasi; null bila tidak dikenal. Pemanggil memeriksa akses pasien. */
  async resolveLabel(barcode: string): Promise<DispenseLabelView | null> {
    const i = await this.tx().dispenseItem.findUnique({
      where: { tenantId_labelBarcode: { tenantId: this.db.tenantId(), labelBarcode: barcode } },
      select: {
        id: true,
        labelBarcode: true,
        quantity: true,
        medicationRequestId: true,
        stockBatch: { select: { batchNo: true, expiryDate: true, drug: { select: { name: true } } } },
        medicationRequest: {
          select: {
            name: true,
            dose: true,
            route: true,
            frequency: true,
            instructions: true,
            highAlert: true,
            encounterId: true,
          },
        },
        dispense: {
          select: {
            id: true,
            preparedAt: true,
            handedOverAt: true,
            patient: { select: { id: true, name: true, mrn: true } },
            prescription: { select: { prescriptionNo: true } },
          },
        },
      },
    });
    if (!i) return null;
    return {
      barcode: i.labelBarcode,
      dispenseItemId: i.id,
      dispenseId: i.dispense.id,
      prescriptionNo: i.dispense.prescription.prescriptionNo,
      medicationRequestId: i.medicationRequestId,
      encounterId: i.medicationRequest.encounterId,
      patient: i.dispense.patient,
      drugName: i.stockBatch.drug.name,
      dose: i.medicationRequest.dose,
      route: i.medicationRequest.route,
      frequency: i.medicationRequest.frequency as DispenseLabelView['frequency'],
      instructions: i.medicationRequest.instructions,
      batchNo: i.stockBatch.batchNo,
      expiryDate: i.stockBatch.expiryDate.toISOString().slice(0, 10),
      quantity: i.quantity,
      highAlert: i.medicationRequest.highAlert,
      preparedAt: i.dispense.preparedAt.toISOString(),
      handedOver: i.dispense.handedOverAt !== null,
    };
  }

  /** `GET labels/:barcode`: label dikenal dan pasiennya boleh dibuka pelaku (ABAC). */
  async label(barcode: string): Promise<DispenseLabelView> {
    const l = DISPENSE_LABEL_PATTERN.test(barcode) ? await this.resolveLabel(barcode) : null;
    if (!l) throw new AppError('NOT_FOUND', 'Label obat tidak dikenal', 404);
    await this.access.assert(l.patient.id);
    return l;
  }
}
