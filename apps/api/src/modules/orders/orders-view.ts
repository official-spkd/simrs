import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  type CdsAlertDecision,
  type CpoeCdsLevel,
  type CpoeCdsRule,
  type CpoeOrderKind,
  type CpoeOrderKind as Kind,
  type MedicationFrequency,
  type OrderGroup,
  type OrderStatus,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const CODE_SYSTEM: Readonly<Record<string, 'LOINC' | 'ICD-9-CM' | 'KFA'>> = {
  loinc: 'LOINC',
  icd9cm: 'ICD-9-CM',
  kfa: 'KFA',
};

export const codeOf = (system: string | null, code: string | null) => {
  const s = system ? CODE_SYSTEM[system] : undefined;
  return s && code ? { system: s, code } : null;
};

interface StoredCompound {
  name: string;
  dosageForm: string;
  quantity: number;
  components: Array<{ drugId: string; amount: string }>;
}

/**
 * K09 · Bentuk jawaban kiriman order (`orderGroupSchema`): isi beku order, status terkini dari `order_status_events`
 * (append-only), temuan CDS, dan resep (dokumen PDF klinis + status TTE). Dipakai setelah kirim, batal, dan daftar
 * order kunjungan.
 */
@Injectable()
export class OrdersView {
  constructor(private readonly db: TenantDb) {}

  async groups(where: Prisma.OrderGroupWhereInput): Promise<OrderGroup[]> {
    const tx = this.db.tx();
    const groups = await tx.orderGroup.findMany({
      where,
      orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
      take: 200,
      include: {
        orderer: { select: { displayName: true } },
        serviceRequests: { include: { orderable: { select: { kind: true } } } },
        medicationRequests: { include: { drug: { select: { codeSystem: true, code: true } } } },
        cdsAlerts: { include: { decider: { select: { displayName: true } } } },
      },
    });
    if (groups.length === 0) return [];
    const serviceIds = groups.flatMap((g) => g.serviceRequests.map((r) => r.id));
    const medicationIds = groups.flatMap((g) => g.medicationRequests.map((r) => r.id));
    const compoundDrugIds = groups.flatMap((g) =>
      g.medicationRequests.flatMap((m) =>
        m.compound ? (m.compound as unknown as StoredCompound).components.map((c) => c.drugId) : [],
      ),
    );
    const [events, drugNames, docs] = await Promise.all([
      tx.orderStatusEvent.findMany({
        where: {
          OR: [{ serviceRequestId: { in: serviceIds } }, { medicationRequestId: { in: medicationIds } }],
        },
        orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
        select: { serviceRequestId: true, medicationRequestId: true, status: true, reason: true },
      }),
      compoundDrugIds.length
        ? tx.drug.findMany({ where: { id: { in: compoundDrugIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      tx.document.findMany({
        where: { sourceType: 'order_groups', sourceId: { in: groups.map((g) => g.id) }, voidedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, sourceId: true, signatures: { select: { id: true, status: true } } },
      }),
    ]);
    // Status terkini = peristiwa terakhir per order.
    const status = new Map<string, { status: OrderStatus; reason: string | null }>();
    for (const e of events) {
      const id = e.serviceRequestId ?? e.medicationRequestId;
      if (id) status.set(id, { status: e.status as OrderStatus, reason: e.reason });
    }
    const current = (id: string) => status.get(id) ?? { status: 'aktif' as const, reason: null };
    const drugName = new Map(drugNames.map((d) => [d.id, d.name]));
    const docByGroup = new Map(docs.map((d) => [d.sourceId, d]));

    return groups.map((g) => {
      const doc = docByGroup.get(g.id);
      const sig = doc?.signatures[0];
      return {
        id: g.id,
        encounterId: g.encounterId,
        patientId: g.patientId,
        orderSetId: g.orderSetId,
        orderedAt: g.orderedAt.toISOString(),
        orderedBy: { userId: g.orderedBy, nama: g.orderer.displayName, peran: g.orderedRole },
        needsReview: g.needsReview,
        serviceRequests: g.serviceRequests.map((r) => ({
          id: r.id,
          orderableId: r.orderableId,
          kind: r.orderable.kind as Exclude<Kind, 'obat'>,
          name: r.name,
          code: codeOf(r.codeSystem, r.code),
          priority: r.priority as 'rutin' | 'cito',
          instructions: r.instructions,
          status: current(r.id).status,
          statusReason: current(r.id).reason,
        })),
        medicationRequests: g.medicationRequests.map((m) => {
          const compound = m.compound ? (m.compound as unknown as StoredCompound) : null;
          return {
            id: m.id,
            drugId: m.drugId,
            compound: compound
              ? {
                  name: compound.name,
                  dosageForm: compound.dosageForm,
                  quantity: compound.quantity,
                  components: compound.components.map((c) => ({
                    drugId: c.drugId,
                    name: drugName.get(c.drugId) ?? 'Obat',
                    amount: c.amount,
                  })),
                }
              : null,
            name: m.name,
            code: m.drug ? codeOf(m.drug.codeSystem, m.drug.code) : null,
            dose: m.dose,
            route: m.route,
            frequency: m.frequency as MedicationFrequency,
            customTimes: m.customTimes,
            durationDays: m.durationDays,
            instructions: m.instructions,
            highAlert: m.highAlert,
            status: current(m.id).status,
            statusReason: current(m.id).reason,
          };
        }),
        cdsAlerts: [...g.cdsAlerts]
          .sort((a, b) => a.lineIndex - b.lineIndex || a.id.localeCompare(b.id))
          .map((a) => ({
            id: a.id,
            orderLineIndex: a.lineIndex,
            ruleCode: a.ruleCode,
            level: a.level as CpoeCdsLevel,
            rule: a.rule as CpoeCdsRule,
            message: a.message,
            decision: a.decision as CdsAlertDecision,
            overrideReason: a.overrideReason,
            decidedBy: { userId: a.decidedBy, nama: a.decider.displayName, peran: a.decidedRole },
            decidedAt: a.decidedAt.toISOString(),
          })),
        prescription: doc
          ? {
              documentId: doc.id,
              signatureId: sig?.id ?? null,
              signatureStatus: (sig?.status as 'pending' | 'signed' | 'failed' | undefined) ?? null,
            }
          : null,
      };
    });
  }

  async group(id: string): Promise<OrderGroup | null> {
    return (await this.groups({ id }))[0] ?? null;
  }
}

/** Jenis staging biaya untuk order penunjang/tindakan (ADR-0032); kontrol tidak ditagih saat diorder. */
export const BILLABLE_FOR: Readonly<Partial<Record<CpoeOrderKind, 'lab' | 'radiologi' | 'tindakan'>>> = {
  lab: 'lab',
  radiologi: 'radiologi',
  tindakan: 'tindakan',
};
