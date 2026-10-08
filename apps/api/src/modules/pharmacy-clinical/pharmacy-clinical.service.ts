import { Injectable } from '@nestjs/common';
import { Prisma, uniqueViolationTarget } from '@simrs/db';
import {
  AppError,
  alertBlocks,
  batchExpired,
  type CdsDecisionInput,
  isoDateJakarta,
  KFA_PATTERN,
  newId,
  type OrderGroup,
  type OrderLineInput,
  type PermissionScope,
  type PharmacistInterventionInput,
  type PharmacistInterventionResponseInput,
  type PharmacyAlertView,
  type PharmacyCdsKind,
  type PharmacyIncoming,
  type PharmacyPrescriptionView,
  type PharmacyQueueRow,
  type PharmacySetting,
  type PrescriptionAcceptInput,
  type PrescriptionReviewInput,
  type PrescriptionStatus,
  reviewBlock,
  supportError,
} from '@simrs/shared';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { type EvaluatedFinding, CdsService } from '../cds/cds.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { OrdersView } from '../orders/orders-view';

type Tx = ReturnType<TenantDb['tx']>;

/**
 * Depo tujuan per kelas kunjungan (ASUMSI fase 4, kode lokasi stok seed 4.0b; ADR-0034 butir 2: order "ditujukan" ke
 * unit depo). Bila RS tidak punya kode itu, depo aktif pertama dalam lingkup sesi dipakai.
 */
const DEPOT_BY_CLASS: Readonly<Record<string, string>> = { AMB: 'DEPO-RJ', IMP: 'DEPO-RI', EMER: 'DEPO-IGD' };
const SETTING_BY_CLASS: Readonly<Record<string, PharmacySetting>> = {
  AMB: 'rawat_jalan',
  IMP: 'rawat_inap',
  EMER: 'igd',
};
/** Antrean masuk: kiriman CPOE 7 hari terakhir (ADR-0034 jendela 7 hari). */
const INCOMING_DAYS = 7;
/** Resep selesai/batal masih tampil di antrean selama 7 hari. */
const CLOSED_VISIBLE_DAYS = 7;
const DAY_MS = 86_400_000;

const KIND_BY_RULE: Readonly<Record<string, PharmacyCdsKind | null>> = {
  alergi: 'alergi',
  'alergi-silang': 'alergi',
  interaksi: 'interaksi',
  ginjal: 'dosis-ginjal',
  dosis: 'dosis-ginjal',
  riwayat: 'kontraindikasi',
  duplikasi: 'kontraindikasi',
  singkatan: 'kontraindikasi',
  biaya: null,
  aman: null,
};
const KIND_TITLE: Readonly<Record<PharmacyCdsKind, string>> = {
  alergi: 'Alergi',
  interaksi: 'Interaksi obat',
  'dosis-ginjal': 'Dosis / fungsi ginjal',
  kontraindikasi: 'Kontraindikasi / duplikasi',
  'high-alert': 'Obat kewaspadaan tinggi',
};
const LEVEL_BY_FINDING = { block: 'mayor', warn: 'sedang', info: 'info' } as const;

const kfaOf = (d: { codeSystem: string | null; code: string | null } | null) =>
  d && d.codeSystem === 'kfa' && d.code && KFA_PATTERN.test(d.code) ? d.code : null;

interface AlertDraft {
  medicationRequestIds: string[];
  level: 'mayor' | 'sedang' | 'info';
  kind: PharmacyCdsKind;
  ruleCode: string;
  ruleVersion: number | null;
  title: string;
  detail: string;
  recommendation: string | null;
  prescriberOverride: boolean;
}

/**
 * S04 · Farmasi klinis (rencana fase 4 §4.5, ADR-0034): antrean kiriman CPOE → resep farmasi (nomor R), CDS ulang saat
 * telaah dengan konteks terkini (alergi, eGFR, obat aktif), tindak lanjut temuan, intervensi ke dokter penulis (resep
 * tidak diubah apoteker), dan telaah tiga aspek (`setujui` diblokir `CDS_UNRESOLVED`). Lingkup `unit` = depo yang
 * unitnya sama dengan unit penugasan sesi; `all` = semua depo.
 */
@Injectable()
export class PharmacyClinicalService {
  constructor(
    private readonly db: TenantDb,
    private readonly numbering: NumberingService,
    private readonly events: DomainEvents,
    private readonly cds: CdsService,
    private readonly orders: OrdersView,
    private readonly notifications: NotificationsService,
  ) {}

  private tx(): Tx {
    return this.db.tx();
  }

  private me(): string {
    const id = this.db.actorUserId();
    if (!id) throw new AppError('FORBIDDEN', 'Farmasi hanya untuk staf yang masuk', 403);
    return id;
  }

  private locationWhere(
    scope: PermissionScope | null = this.db.permissionScope(),
  ): Prisma.StockLocationWhereInput {
    if (scope === 'all') return { active: true };
    const unitId = scope === 'unit' ? this.db.actor().unitId : null;
    return unitId ? { active: true, unitId } : { id: { in: [] } };
  }

  private inScope(unitId: string, scope: PermissionScope | null = this.db.permissionScope()): boolean {
    if (scope === 'all') return true;
    return scope === 'unit' && this.db.actor().unitId === unitId;
  }

  /** Depo dalam lingkup untuk kelas kunjungan (kode baku dulu, lalu depo pertama dalam lingkup). */
  private routeDepot(
    encounterClass: string,
    depots: ReadonlyArray<{ id: string; code: string; name: string; kind: string }>,
  ) {
    const code = DEPOT_BY_CLASS[encounterClass];
    return depots.find((d) => d.code === code) ?? null;
  }

  // ─── Antrean ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Kiriman CPOE ber-obat aktif yang belum diterima farmasi dan ditujukan ke depo dalam lingkup sesi. */
  async incoming(): Promise<PharmacyIncoming[]> {
    const depots = await this.tx().stockLocation.findMany({
      where: { ...this.locationWhere(), kind: 'depo' },
      select: { id: true, code: true, name: true, kind: true },
    });
    if (depots.length === 0) return [];
    const classes = Object.entries(DEPOT_BY_CLASS)
      .filter(([, code]) => depots.some((d) => d.code === code))
      .map(([cls]) => cls);
    if (classes.length === 0) return [];
    const groups = await this.orders.groups({
      pharmacyPrescription: null,
      medicationRequests: { some: {} },
      orderedAt: { gte: new Date(Date.now() - INCOMING_DAYS * DAY_MS) },
      encounter: { encounterClass: { in: classes }, status: { not: 'cancelled' } },
    });
    const active = groups.filter((g) => g.medicationRequests.some((m) => m.status === 'aktif'));
    if (active.length === 0) return [];
    const encounters = await this.tx().encounter.findMany({
      where: { id: { in: active.map((g) => g.encounterId) } },
      select: {
        id: true,
        number: true,
        encounterClass: true,
        unit: { select: { name: true } },
        patient: { select: { id: true, name: true, mrn: true } },
      },
    });
    const byId = new Map(encounters.map((e) => [e.id, e]));
    const out: PharmacyIncoming[] = [];
    for (const g of active) {
      const e = byId.get(g.encounterId);
      if (!e) continue;
      const depot = this.routeDepot(e.encounterClass, depots);
      if (!depot) continue;
      out.push({
        orderGroupId: g.id,
        encounter: {
          id: e.id,
          number: e.number,
          class: e.encounterClass as PharmacyIncoming['encounter']['class'],
          unitName: e.unit.name,
        },
        patient: e.patient,
        orderedAt: g.orderedAt,
        orderedBy: g.orderedBy,
        needsReview: g.needsReview,
        items: g.medicationRequests.filter((m) => m.status === 'aktif'),
        stockLocation: { id: depot.id, name: depot.name },
      });
    }
    return out.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
  }

  /** Resep farmasi di depo dalam lingkup: terbuka, atau selesai/batal 7 hari terakhir. */
  async queue(status?: PrescriptionStatus): Promise<PharmacyQueueRow[]> {
    const rows = await this.tx().pharmacyPrescription.findMany({
      where: {
        stockLocation: this.locationWhere(),
        ...(status
          ? { status }
          : {
              OR: [
                { status: { notIn: ['selesai', 'batal'] } },
                { updatedAt: { gte: new Date(Date.now() - CLOSED_VISIBLE_DAYS * DAY_MS) } },
              ],
            }),
      },
      orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: {
        id: true,
        prescriptionNo: true,
        status: true,
        setting: true,
        acceptedAt: true,
        stockLocation: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, mrn: true } },
        encounter: { select: { number: true } },
        orderGroup: {
          select: {
            orderer: { select: { displayName: true } },
            medicationRequests: { select: { id: true, highAlert: true } },
          },
        },
      },
    });
    const blocking = await this.blockingCounts(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      prescriptionNo: r.prescriptionNo,
      status: r.status as PrescriptionStatus,
      setting: r.setting as PharmacySetting,
      stockLocation: r.stockLocation,
      patient: r.patient,
      encounterNumber: r.encounter.number,
      prescriber: r.orderGroup.orderer.displayName,
      acceptedAt: r.acceptedAt.toISOString(),
      items: r.orderGroup.medicationRequests.length,
      highAlert: r.orderGroup.medicationRequests.some((m) => m.highAlert),
      blockingAlerts: blocking.get(r.id) ?? 0,
    }));
  }

  /** Jumlah temuan CDS yang menahan telaah per resep (putaran evaluasi terbaru). */
  private async blockingCounts(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.tx().$queryRaw<Array<{ id: string; n: bigint }>>`
      SELECT a.pharmacy_prescription_id::text AS id, count(*)::bigint AS n
      FROM pharmacy_cds_alerts a
      LEFT JOIN pharmacy_cds_alert_decisions d ON d.tenant_id = a.tenant_id AND d.alert_id = a.id
      WHERE a.pharmacy_prescription_id = ANY(${[...ids]}::uuid[])
        AND a.evaluation_id = (
          SELECT x.evaluation_id FROM pharmacy_cds_alerts x
          WHERE x.tenant_id = a.tenant_id AND x.pharmacy_prescription_id = a.pharmacy_prescription_id
          ORDER BY x.created_at DESC, x.id DESC LIMIT 1)
        AND a.level <> 'info' AND (d.id IS NULL OR d.decision = 'usul')
      GROUP BY a.pharmacy_prescription_id`;
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  // ─── Resep ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async prescriptionRow(id: string, lock = false) {
    if (lock)
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
        setting: true,
        acceptedAt: true,
        stockLocation: { select: { id: true, name: true, unitId: true } },
        acceptor: { select: { id: true, displayName: true } },
      },
    });
    if (!p) throw new AppError('NOT_FOUND', 'Resep farmasi tidak ditemukan', 404);
    if (!this.inScope(p.stockLocation.unitId)) {
      throw new AppError('FORBIDDEN', `Resep ini dilayani ${p.stockLocation.name}, di luar unit Anda`, 403);
    }
    return p;
  }

  private async group(orderGroupId: string): Promise<OrderGroup> {
    const g = await this.orders.group(orderGroupId);
    if (!g) throw new AppError('NOT_FOUND', 'Kiriman order tidak ditemukan', 404);
    return g;
  }

  async view(id: string): Promise<PharmacyPrescriptionView> {
    const p = await this.prescriptionRow(id);
    const g = await this.group(p.orderGroupId);
    const enc = await this.tx().encounter.findUniqueOrThrow({
      where: { id: p.encounterId },
      select: {
        id: true,
        number: true,
        encounterClass: true,
        unit: { select: { name: true } },
        patient: { select: { id: true, name: true, mrn: true } },
      },
    });
    const ctx = await this.cds.patientContext(p.encounterId, p.patientId);
    const drugIds = g.medicationRequests.flatMap((m) => (m.drugId ? [m.drugId] : []));
    const [drugs, balances, profiles, alerts, reviews, interventions] = await Promise.all([
      this.tx().drug.findMany({
        where: { id: { in: drugIds } },
        select: { id: true, codeSystem: true, code: true, fornas: true },
      }),
      this.tx().stockBalance.findMany({
        where: { stockLocationId: p.stockLocation.id, drugId: { in: drugIds }, quantity: { gt: 0 } },
        select: { drugId: true, quantity: true, stockBatch: { select: { expiryDate: true } } },
      }),
      this.tx().formularyStockProfile.findMany({
        where: { stockLocationId: p.stockLocation.id, drugId: { in: drugIds } },
        select: { drugId: true, minQuantity: true },
      }),
      this.alertViews(p.id),
      this.tx().prescriptionReview.findMany({
        where: { pharmacyPrescriptionId: p.id },
        orderBy: [{ reviewedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          administratif: true,
          farmasetik: true,
          klinis: true,
          decision: true,
          reason: true,
          medicationRequestIds: true,
          reviewedAt: true,
          reviewer: { select: { id: true, displayName: true } },
        },
      }),
      this.tx().pharmacistIntervention.findMany({
        where: { pharmacyPrescriptionId: p.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          kind: true,
          medicationRequestIds: true,
          recommendation: true,
          createdAt: true,
          prescriber: { select: { id: true, displayName: true } },
          creator: { select: { id: true, displayName: true } },
          response: {
            select: {
              response: true,
              note: true,
              respondedAt: true,
              responder: { select: { id: true, displayName: true } },
            },
          },
        },
      }),
    ]);
    const today = isoDateJakarta();
    const drugById = new Map(drugs.map((d) => [d.id, d]));
    const usable = new Map<string, number>();
    for (const b of balances) {
      if (batchExpired(b.stockBatch.expiryDate.toISOString().slice(0, 10), today)) continue;
      usable.set(b.drugId, (usable.get(b.drugId) ?? 0) + b.quantity);
    }
    const minByDrug = new Map(profiles.map((x) => [x.drugId, x.minQuantity]));
    const person = (u: { id: string; displayName: string }) => ({ userId: u.id, nama: u.displayName });
    return {
      id: p.id,
      prescriptionNo: p.prescriptionNo,
      orderGroupId: p.orderGroupId,
      status: p.status as PrescriptionStatus,
      setting: p.setting as PharmacySetting,
      stockLocation: { id: p.stockLocation.id, name: p.stockLocation.name },
      encounter: {
        id: enc.id,
        number: enc.number,
        class: enc.encounterClass as PharmacyPrescriptionView['encounter']['class'],
        unitName: enc.unit.name,
      },
      patient: enc.patient,
      allergies: ctx.allergies.map((a) => a.label),
      egfr: ctx.egfr,
      prescriber: g.orderedBy,
      orderedAt: g.orderedAt,
      acceptedBy: person(p.acceptor),
      acceptedAt: p.acceptedAt.toISOString(),
      needsReview: g.needsReview,
      items: g.medicationRequests.map((m) => {
        const d = m.drugId ? drugById.get(m.drugId) : null;
        return {
          ...m,
          kfa: kfaOf(d ?? null),
          fornas: d?.fornas ?? false,
          stock: {
            usable: m.drugId ? (usable.get(m.drugId) ?? 0) : 0,
            minQuantity: m.drugId ? (minByDrug.get(m.drugId) ?? null) : null,
          },
        };
      }),
      alerts,
      reviews: reviews.map((r) => ({
        id: r.id,
        aspects: { administratif: r.administratif, farmasetik: r.farmasetik, klinis: r.klinis },
        decision: r.decision as PharmacyPrescriptionView['reviews'][number]['decision'],
        reason: r.reason,
        medicationRequestIds: r.medicationRequestIds,
        by: person(r.reviewer),
        at: r.reviewedAt.toISOString(),
      })),
      interventions: interventions.map((i) => ({
        id: i.id,
        kind: i.kind as PharmacyPrescriptionView['interventions'][number]['kind'],
        medicationRequestIds: i.medicationRequestIds,
        recommendation: i.recommendation,
        prescriber: person(i.prescriber),
        by: person(i.creator),
        at: i.createdAt.toISOString(),
        response: i.response
          ? {
              response: i.response.response as 'diterima' | 'ditolak' | 'diubah',
              note: i.response.note,
              by: person(i.response.responder),
              at: i.response.respondedAt.toISOString(),
            }
          : null,
      })),
    };
  }

  /** Temuan CDS putaran evaluasi terbaru + tindak lanjutnya. */
  private async alertViews(prescriptionId: string): Promise<PharmacyAlertView[]> {
    const latest = await this.tx().pharmacyCdsAlert.findFirst({
      where: { pharmacyPrescriptionId: prescriptionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { evaluationId: true },
    });
    if (!latest) return [];
    const rows = await this.tx().pharmacyCdsAlert.findMany({
      where: { pharmacyPrescriptionId: prescriptionId, evaluationId: latest.evaluationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        level: true,
        kind: true,
        ruleCode: true,
        title: true,
        detail: true,
        recommendation: true,
        medicationRequestIds: true,
        prescriberOverride: true,
        decision: {
          select: {
            decision: true,
            reason: true,
            decidedAt: true,
            decider: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    const rank = { mayor: 0, sedang: 1, info: 2 } as const;
    return rows
      .map((a): PharmacyAlertView => {
        const d = a.decision;
        const status: PharmacyAlertView['status'] =
          d && d.decision !== 'usul' ? 'teratasi' : a.prescriberOverride && !d ? 'override' : 'terbuka';
        const level = a.level as PharmacyAlertView['level'];
        return {
          id: a.id,
          level,
          kind: a.kind as PharmacyAlertView['kind'],
          ruleCode: a.ruleCode,
          title: a.title,
          detail: a.detail,
          recommendation: a.recommendation,
          medicationRequestIds: a.medicationRequestIds,
          prescriberOverride: a.prescriberOverride,
          status,
          decision: d
            ? {
                decision: d.decision as 'konfirmasi' | 'override' | 'usul',
                reason: d.reason,
                by: { userId: d.decider.id, nama: d.decider.displayName },
                at: d.decidedAt.toISOString(),
              }
            : null,
          blocking: alertBlocks({ status, level }),
        };
      })
      .sort((x, y) => rank[x.level] - rank[y.level]);
  }

  // ─── Tulis ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Terima kiriman CPOE ke depo (sekali per kiriman): nomor R, status `telaah`, evaluasi CDS awal, event. */
  async accept(input: PrescriptionAcceptInput): Promise<PharmacyPrescriptionView> {
    const me = this.me();
    const tenantId = this.db.tenantId();
    await this.tx()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:pharmacy.accept:${input.orderGroupId}`}, 0))`;
    const existing = await this.tx().pharmacyPrescription.findUnique({
      where: { tenantId_orderGroupId: { tenantId, orderGroupId: input.orderGroupId } },
      select: { prescriptionNo: true },
    });
    if (existing) {
      throw new AppError('CONFLICT', `Kiriman ini sudah diterima farmasi (${existing.prescriptionNo})`, 409);
    }
    const g = await this.group(input.orderGroupId);
    if (!g.medicationRequests.some((m) => m.status === 'aktif')) {
      throw new AppError('CONFLICT', 'Kiriman ini tidak memuat obat aktif', 409);
    }
    const loc = await this.tx().stockLocation.findUnique({
      where: { id: input.stockLocationId },
      select: { id: true, name: true, unitId: true, active: true, kind: true },
    });
    if (!loc?.active) throw new AppError('NOT_FOUND', 'Depo tidak ditemukan', 404);
    if (!this.inScope(loc.unitId)) throw new AppError('FORBIDDEN', `${loc.name} di luar unit Anda`, 403);
    const enc = await this.tx().encounter.findUniqueOrThrow({
      where: { id: g.encounterId },
      select: { encounterClass: true, status: true },
    });
    if (enc.status === 'cancelled') throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan', 409);
    const setting = SETTING_BY_CLASS[enc.encounterClass] ?? 'rawat_jalan';
    const id = newId();
    const { number: prescriptionNo } = await this.numbering.next('prescription_no');
    try {
      await this.tx().pharmacyPrescription.create({
        data: {
          id,
          tenantId,
          prescriptionNo,
          orderGroupId: g.id,
          encounterId: g.encounterId,
          patientId: g.patientId,
          stockLocationId: loc.id,
          setting,
          acceptedBy: me,
        },
      });
    } catch (err) {
      if (/order_group/.test(uniqueViolationTarget(err))) {
        throw new AppError('CONFLICT', 'Kiriman ini sudah diterima farmasi', 409);
      }
      throw err;
    }
    await this.history(id, null, 'telaah', null);
    await this.runCds(id, g);
    await this.events.publish('pharmacy.service_started', {
      pharmacyPrescriptionId: id,
      orderGroupId: g.id,
      encounterId: g.encounterId,
      patientId: g.patientId,
      unitId: loc.unitId,
      setting,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'pharmacy_prescription',
      resourceId: id,
      patientId: g.patientId,
      details: { orderGroupId: g.id, stockLocationId: loc.id },
    });
    return this.view(id);
  }

  private async history(id: string, from: string | null, to: string, reason: string | null) {
    await this.tx().pharmacyPrescriptionStatusHistory.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        pharmacyPrescriptionId: id,
        fromStatus: from,
        toStatus: to,
        changedBy: this.me(),
        reason,
      },
    });
  }

  /** Ubah status resep + riwayat (dipakai juga dispensing 4.6b: penyiapan → serah → selesai). */
  async setStatus(id: string, from: string, to: PrescriptionStatus, reason: string | null) {
    if (from === to) return;
    await this.tx().pharmacyPrescription.update({ where: { id }, data: { status: to } });
    await this.history(id, from, to, reason);
  }

  /**
   * CDS ulang dengan konteks terkini (alergi, eGFR, obat aktif di luar resep ini) atas obat aktif resep. Blok → mayor,
   * peringatan → sedang; override dokter di CPOE atas temuan blok → mayor `prescriber_override`; obat kewaspadaan
   * tinggi → info. Tindak lanjut final (konfirmasi/override) atas temuan yang sama dibawa ke putaran baru.
   */
  private async runCds(prescriptionId: string, g: OrderGroup): Promise<void> {
    const meds = g.medicationRequests.filter((m) => m.status === 'aktif');
    const items = meds.map((m): OrderLineInput => ({
      type: 'obat',
      drugId: m.drugId,
      compound: m.compound
        ? {
            name: m.compound.name,
            dosageForm: m.compound.dosageForm,
            quantity: m.compound.quantity,
            components: m.compound.components.map((c) => ({ drugId: c.drugId, amount: c.amount })),
          }
        : null,
      dose: m.dose,
      route: m.route,
      frequency: m.frequency,
      customTimes: m.customTimes.length > 0 ? m.customTimes : null,
      durationDays: m.durationDays,
      instructions: m.instructions,
      override: null,
    }));
    const drafts: AlertDraft[] = [];
    if (items.length > 0) {
      const { lines } = await this.cds.evaluate({ id: g.encounterId, patientId: g.patientId }, items, {
        excludeActiveDrugIds: meds.flatMap((m) => (m.drugId ? [m.drugId] : [])),
      });
      // Override dokter di CPOE atas temuan blok (cds_alerts kiriman ini) → mayor `prescriber_override`.
      const overridden = await this.tx().cdsAlert.findMany({
        where: { orderGroupId: g.id, decision: 'override', level: 'block' },
        select: { medicationRequestId: true, rule: true, overrideReason: true },
      });
      for (const line of lines) {
        const med = meds[line.index];
        if (!med) continue;
        for (const f of line.findings) {
          const draft = this.draftFrom(f, med.id, med.name, overridden);
          if (draft) drafts.push(draft);
        }
      }
    }
    for (const m of meds.filter((x) => x.highAlert)) {
      drafts.push({
        medicationRequestIds: [m.id],
        level: 'info',
        kind: 'high-alert',
        ruleCode: 'bawaan:high-alert',
        ruleVersion: null,
        title: `${KIND_TITLE['high-alert']} · ${m.name}`,
        detail: 'Obat kewaspadaan tinggi: penyiapan wajib cek ganda apoteker kedua sebelum diserahkan.',
        recommendation: null,
        prescriberOverride: false,
      });
    }
    const previous = await this.alertViews(prescriptionId);
    const evaluationId = newId();
    const me = this.me();
    const tenantId = this.db.tenantId();
    // Satu temuan per (aturan, item); urutan tetap agar putaran yang sama menghasilkan daftar yang sama.
    const seen = new Set<string>();
    for (const d of drafts) {
      const key = `${d.ruleCode}|${d.medicationRequestIds.join(',')}|${d.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = newId();
      await this.tx().pharmacyCdsAlert.create({
        data: {
          id,
          tenantId,
          pharmacyPrescriptionId: prescriptionId,
          evaluationId,
          medicationRequestIds: d.medicationRequestIds,
          level: d.level,
          kind: d.kind,
          ruleCode: d.ruleCode,
          ruleVersion: d.ruleVersion,
          title: d.title.slice(0, 200),
          detail: d.detail.slice(0, 1000),
          recommendation: d.recommendation,
          prescriberOverride: d.prescriberOverride,
          createdBy: me,
        },
      });
      const carried = previous.find(
        (p) =>
          p.ruleCode === d.ruleCode &&
          p.detail === d.detail.slice(0, 1000) &&
          p.medicationRequestIds.join(',') === d.medicationRequestIds.join(',') &&
          p.decision &&
          p.decision.decision !== 'usul',
      );
      if (carried?.decision) {
        await this.tx().pharmacyCdsAlertDecision.create({
          data: {
            id: newId(),
            tenantId,
            alertId: id,
            decision: carried.decision.decision,
            reason: carried.decision.reason,
            decidedBy: carried.decision.by.userId,
          },
        });
      }
    }
    if (drafts.length === 0) {
      // Putaran tanpa temuan tetap dicatat agar putaran lama tidak lagi berlaku: satu catatan info "aman".
      await this.tx().pharmacyCdsAlert.create({
        data: {
          id: newId(),
          tenantId,
          pharmacyPrescriptionId: prescriptionId,
          evaluationId,
          medicationRequestIds: meds.map((m) => m.id),
          level: 'info',
          kind: 'kontraindikasi',
          ruleCode: 'bawaan:aman',
          title: 'Tidak ada temuan CDS',
          detail: 'Evaluasi CDS saat telaah tidak menemukan alergi, interaksi, atau masalah dosis.',
          createdBy: me,
        },
      });
    }
  }

  private draftFrom(
    f: EvaluatedFinding,
    medicationRequestId: string,
    medName: string,
    overridden: ReadonlyArray<{
      medicationRequestId: string | null;
      rule: string;
      overrideReason: string | null;
    }>,
  ): AlertDraft | null {
    const kind = KIND_BY_RULE[f.rule] ?? null;
    if (!kind) return null;
    const level = LEVEL_BY_FINDING[f.level];
    const doctor =
      f.level === 'block'
        ? overridden.find((a) => a.medicationRequestId === medicationRequestId && a.rule === f.rule)
        : undefined;
    return {
      medicationRequestIds: [medicationRequestId],
      level,
      kind,
      ruleCode: f.ruleCode,
      ruleVersion: f.ruleVersion,
      title: `${KIND_TITLE[kind]} · ${medName}`,
      detail: doctor
        ? `${f.message} Dokter melanjutkan di CPOE dengan alasan: ${doctor.overrideReason ?? '-'}`
        : f.message,
      recommendation: null,
      prescriberOverride: Boolean(doctor),
    };
  }

  /** `POST :id/cds/evaluate`: CDS ulang (mis. setelah dokter mengubah order di CPOE). */
  async evaluate(id: string): Promise<PharmacyPrescriptionView> {
    const p = await this.prescriptionRow(id, true);
    this.assertReviewable(p.status);
    await this.runCds(p.id, await this.group(p.orderGroupId));
    this.db.audit({
      action: 'update',
      resourceType: 'pharmacy_prescription',
      resourceId: p.id,
      patientId: p.patientId,
      details: { cds: 'evaluate' },
    });
    return this.view(p.id);
  }

  private assertReviewable(status: string) {
    if (status !== 'telaah' && status !== 'ditahan') {
      throw new AppError('CONFLICT', `Resep berstatus ${status}; telaah sudah selesai`, 409, { status });
    }
  }

  /** Tindak lanjut apoteker atas satu temuan putaran terbaru (sekali per temuan). */
  async decide(id: string, alertId: string, input: CdsDecisionInput): Promise<PharmacyPrescriptionView> {
    const p = await this.prescriptionRow(id, true);
    this.assertReviewable(p.status);
    const current = await this.alertViews(p.id);
    const alert = current.find((a) => a.id === alertId);
    if (!alert)
      throw new AppError('NOT_FOUND', 'Temuan CDS tidak ditemukan pada telaah terbaru resep ini', 404);
    if (alert.decision) throw new AppError('CONFLICT', 'Temuan ini sudah ditindaklanjuti', 409);
    try {
      await this.tx().pharmacyCdsAlertDecision.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          alertId,
          decision: input.decision,
          reason: input.reason?.trim() || null,
          decidedBy: this.me(),
        },
      });
    } catch (err) {
      if (/alert_id/.test(uniqueViolationTarget(err))) {
        throw new AppError('CONFLICT', 'Temuan ini sudah ditindaklanjuti', 409);
      }
      throw err;
    }
    this.db.audit({
      action: 'update',
      resourceType: 'pharmacy_cds_alert',
      resourceId: alertId,
      patientId: p.patientId,
      reason: input.decision === 'override' ? (input.reason ?? null) : null,
      details: { decision: input.decision, level: alert.level },
    });
    return this.view(p.id);
  }

  /** Intervensi ke dokter penulis (notifikasi tanpa PHI). Apoteker tidak mengubah resep: dokter menindaklanjuti di CPOE. */
  async intervene(id: string, input: PharmacistInterventionInput): Promise<PharmacyPrescriptionView> {
    const p = await this.prescriptionRow(id);
    this.assertReviewable(p.status);
    const g = await this.group(p.orderGroupId);
    const ids = new Set(g.medicationRequests.map((m) => m.id));
    if (!input.medicationRequestIds.every((m) => ids.has(m))) {
      throw new AppError('VALIDATION_FAILED', 'Item intervensi harus item resep ini', 400);
    }
    const interventionId = newId();
    await this.tx().pharmacistIntervention.create({
      data: {
        id: interventionId,
        tenantId: this.db.tenantId(),
        pharmacyPrescriptionId: p.id,
        kind: input.kind,
        medicationRequestIds: input.medicationRequestIds,
        recommendation: input.recommendation.trim(),
        prescriberUserId: g.orderedBy.userId,
        createdBy: this.me(),
      },
    });
    await this.notifications.notify([g.orderedBy.userId], {
      kind: 'pharmacy.intervention',
      title: 'Usulan apoteker atas resep Anda',
      body: `Apoteker mengirim usulan untuk resep ${p.prescriptionNo}. Buka CPOE kunjungan untuk menindaklanjuti.`,
      link: `/klinis/order/${p.encounterId}`,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'pharmacist_intervention',
      resourceId: interventionId,
      patientId: p.patientId,
      details: { kind: input.kind, items: input.medicationRequestIds.length },
    });
    return this.view(p.id);
  }

  /**
   * Telaah tiga aspek: `setujui` diblokir selama ada temuan mayor/sedang terbuka atau override dokter atas temuan mayor
   * belum ditinjau (`CDS_UNRESOLVED`); `sebagian` hanya item aktif resep; `tahan` → status `ditahan`.
   */
  async review(id: string, input: PrescriptionReviewInput): Promise<PharmacyPrescriptionView> {
    const p = await this.prescriptionRow(id, true);
    this.assertReviewable(p.status);
    const g = await this.group(p.orderGroupId);
    const active = new Set(g.medicationRequests.filter((m) => m.status === 'aktif').map((m) => m.id));
    if (input.decision === 'sebagian' && !input.medicationRequestIds.every((m) => active.has(m))) {
      throw new AppError('VALIDATION_FAILED', 'Item yang disetujui harus item aktif resep ini', 400);
    }
    if (input.decision !== 'tahan') {
      const alerts = await this.alertViews(p.id);
      // `sebagian`: hanya temuan pada item yang disetujui yang menahan.
      const relevant = alerts.filter(
        (a) =>
          input.decision !== 'sebagian' ||
          a.medicationRequestIds.some((m) => input.medicationRequestIds.includes(m)),
      );
      const code = reviewBlock('setujui', relevant);
      if (code) throw supportError(code, { alertIds: relevant.filter((a) => a.blocking).map((a) => a.id) });
    }
    const reviewId = newId();
    await this.tx().prescriptionReview.create({
      data: {
        id: reviewId,
        tenantId: this.db.tenantId(),
        pharmacyPrescriptionId: p.id,
        administratif: input.aspects.administratif,
        farmasetik: input.aspects.farmasetik,
        klinis: input.aspects.klinis,
        decision: input.decision,
        reason: input.reason?.trim() || null,
        medicationRequestIds: input.decision === 'sebagian' ? input.medicationRequestIds : [],
        reviewedBy: this.me(),
      },
    });
    await this.setStatus(
      p.id,
      p.status,
      input.decision === 'tahan' ? 'ditahan' : 'penyiapan',
      input.reason?.trim() || null,
    );
    this.db.audit({
      action: 'verify',
      resourceType: 'pharmacy_prescription',
      resourceId: p.id,
      patientId: p.patientId,
      reason: input.reason ?? null,
      details: { decision: input.decision },
    });
    return this.view(p.id);
  }

  /** Dokter penulis menjawab usulan apoteker (sekali per intervensi). Order tetap diubah dokter lewat CPOE. */
  async respond(
    interventionId: string,
    input: PharmacistInterventionResponseInput,
  ): Promise<{ id: string; response: PharmacistInterventionResponseInput['response'] }> {
    const me = this.me();
    const i = await this.tx().pharmacistIntervention.findUnique({
      where: { id: interventionId },
      select: {
        id: true,
        prescriberUserId: true,
        createdBy: true,
        prescription: { select: { id: true, prescriptionNo: true, patientId: true } },
        response: { select: { id: true } },
      },
    });
    if (!i) throw new AppError('NOT_FOUND', 'Usulan apoteker tidak ditemukan', 404);
    if (i.prescriberUserId !== me) {
      throw new AppError('FORBIDDEN', 'Hanya dokter penulis resep yang menjawab usulan ini', 403);
    }
    if (i.response) throw new AppError('CONFLICT', 'Usulan ini sudah dijawab', 409);
    try {
      await this.tx().pharmacistInterventionResponse.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          interventionId: i.id,
          response: input.response,
          note: input.note?.trim() || null,
          respondedBy: me,
        },
      });
    } catch (err) {
      if (/intervention_id/.test(uniqueViolationTarget(err))) {
        throw new AppError('CONFLICT', 'Usulan ini sudah dijawab', 409);
      }
      throw err;
    }
    await this.notifications.notify([i.createdBy], {
      kind: 'pharmacy.intervention_response',
      title: 'Dokter menjawab usulan apoteker',
      body: `Usulan untuk resep ${i.prescription.prescriptionNo} dijawab: ${input.response}.`,
      link: `/penunjang/farmasi?resep=${i.prescription.id}`,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'pharmacist_intervention_response',
      resourceId: i.id,
      patientId: i.prescription.patientId,
      details: { response: input.response },
    });
    return { id: i.id, response: input.response };
  }
}
