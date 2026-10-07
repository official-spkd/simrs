import { Injectable } from '@nestjs/common';
import { uniqueViolationTarget } from '@simrs/db';
import {
  AppError,
  type CpoeCoverage,
  type CpoeOrderKind,
  newId,
  type OrderCatalogItem,
  type OrderCatalogQuery,
  type OrderSetCreateInput,
  type OrderSetView,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { codeOf } from './orders-view';

/**
 * K09 · Katalog order (orderable penunjang/tindakan + obat aktif RS) dan order set institusi. Tarif tidak dikirim
 * (null) sampai master tarif U01 (fase 5, keputusan fase 3 no. 14). Order set dikelola `order.manage`.
 */
@Injectable()
export class OrderCatalogService {
  constructor(private readonly db: TenantDb) {}

  async catalog(q: OrderCatalogQuery): Promise<OrderCatalogItem[]> {
    const tx = this.db.tx();
    const term = q.q.trim();
    const match = term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { keywords: { contains: term.toLowerCase() } },
          ],
        }
      : {};
    const wantDrugs = !q.kind || q.kind === 'obat';
    const wantOrderables = q.kind !== 'obat';
    const [orderables, drugs] = await Promise.all([
      wantOrderables
        ? tx.orderable.findMany({
            where: { active: true, ...(q.kind ? { kind: q.kind } : {}), ...match },
            orderBy: [{ kind: 'asc' }, { name: 'asc' }],
            take: q.limit,
          })
        : Promise.resolve([]),
      wantDrugs
        ? tx.drug.findMany({
            where: { active: true, ...match },
            orderBy: { name: 'asc' },
            take: q.limit,
            include: { substance: { select: { code: true, classes: true } } },
          })
        : Promise.resolve([]),
    ]);
    const items: OrderCatalogItem[] = [
      ...orderables.map((o) => ({
        id: o.id,
        kind: o.kind as OrderCatalogItem['kind'],
        name: o.name,
        code: codeOf(o.codeSystem, o.code),
        coverage: o.coverage as CpoeCoverage,
        priority: o.priority as 'rutin' | 'cito',
        tariff: null,
        substance: null,
        classes: [],
        highAlert: false,
        unitId: o.unitId,
      })),
      ...drugs.map((d) => ({
        id: d.id,
        kind: 'obat' as const,
        name: d.name,
        code: codeOf(d.codeSystem, d.code),
        coverage: d.coverage as CpoeCoverage,
        priority: 'rutin' as const,
        tariff: null,
        substance: d.substance?.code ?? null,
        classes: d.substance?.classes ?? [],
        highAlert: d.highAlert,
        unitId: null,
      })),
    ];
    return items.slice(0, q.limit);
  }

  async orderSets(): Promise<OrderSetView[]> {
    const sets = await this.db.tx().orderSet.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            orderable: { select: { id: true, kind: true, name: true, active: true } },
            drug: { select: { id: true, name: true, active: true } },
          },
        },
      },
    });
    return sets.map((s) => this.presentSet(s));
  }

  async createOrderSet(input: OrderSetCreateInput): Promise<OrderSetView> {
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const orderableIds = input.items.flatMap((i) => ('orderableId' in i ? [i.orderableId] : []));
    const drugIds = input.items.flatMap((i) => ('drugId' in i ? [i.drugId] : []));
    const [orderables, drugs] = await Promise.all([
      tx.orderable.count({ where: { id: { in: orderableIds }, active: true } }),
      tx.drug.count({ where: { id: { in: drugIds }, active: true } }),
    ]);
    if (orderables !== new Set(orderableIds).size || drugs !== new Set(drugIds).size) {
      throw new AppError('VALIDATION_FAILED', 'Isi order set memuat item tidak dikenal atau nonaktif', 422);
    }
    const id = newId();
    try {
      await tx.orderSet.create({
        data: {
          id,
          tenantId,
          code: input.code,
          name: input.name,
          description: input.description,
          createdBy: this.db.actorUserId(),
          updatedBy: this.db.actorUserId(),
        },
      });
      await tx.orderSetItem.createMany({
        data: input.items.map((item, sortOrder) => ({
          id: newId(),
          tenantId,
          orderSetId: id,
          sortOrder,
          ...('orderableId' in item ? { orderableId: item.orderableId } : { drugId: item.drugId }),
        })),
      });
    } catch (err) {
      if (/code/.test(uniqueViolationTarget(err))) {
        throw new AppError('CONFLICT', `Kode order set ${input.code} sudah dipakai`, 409);
      }
      throw err;
    }
    this.db.audit({
      action: 'create',
      resourceType: 'order_set',
      resourceId: id,
      details: { code: input.code, items: input.items.length },
    });
    const sets = await this.orderSets();
    const created = sets.find((s) => s.id === id);
    if (!created) throw new Error('Order set baru tidak terbaca');
    return created;
  }

  private presentSet(s: {
    id: string;
    code: string;
    name: string;
    description: string;
    items: Array<{
      orderable: { id: string; kind: string; name: string; active: boolean } | null;
      drug: { id: string; name: string; active: boolean } | null;
    }>;
  }): OrderSetView {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      description: s.description,
      items: s.items.flatMap((i): OrderSetView['items'] => {
        if (i.orderable) {
          return [
            {
              type: 'layanan' as const,
              ...i.orderable,
              kind: i.orderable.kind as Exclude<CpoeOrderKind, 'obat'>,
            },
          ];
        }
        if (i.drug) return [{ type: 'obat' as const, kind: 'obat' as const, ...i.drug }];
        return [];
      }),
    };
  }
}
