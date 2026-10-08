import { Injectable } from '@nestjs/common';
import { dbDateFromIso, isoFromDbDate, Prisma } from '@simrs/db';
import {
  AppError,
  type DietOrderInput,
  type DietOrderRecord,
  type DietTypeOption,
  type EncounterNutrition,
  isoDateJakarta,
  type MealList,
  type MealListQuery,
  type MealListRow,
  type MealServiceRecord,
  mstScore,
  newId,
  type NpoInput,
  type NpoRecord,
  type NutritionScreeningInput,
  type NutritionScreeningRecord,
} from '@simrs/shared';
import type { z } from 'zod';
import type { mealServiceInputSchema } from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import {
  assertSupportItem,
  inSupportWindow,
  patientsLite,
  supportScope,
  supportWrite,
  userNames,
} from '../../infra/clinical/support-access';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { DiagnosisService } from '../diagnosis/diagnosis.service';
import { allergyLabels } from '../summary/summary.service';

type MealServiceInput = z.infer<typeof mealServiceInputSchema>;

const MAX_ROWS = 500;
/** Kelas kunjungan yang dilayani dapur (rawat inap, observasi IGD). */
const SERVED_CLASSES = new Set(['IMP', 'EMER']);
const FUTURE_TOLERANCE_MS = 5 * 60_000;

interface OrderRow {
  id: string;
  encounterId: string;
  patientId: string;
  texture: string;
  notes: string | null;
  startsOn: Date;
  status: string;
  endedAt: Date | null;
  orderedBy: string;
  orderedAt: Date;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  dietType: { id: string; code: string; name: string };
}

const ORDER_SELECT = {
  id: true,
  encounterId: true,
  patientId: true,
  texture: true,
  notes: true,
  startsOn: true,
  status: true,
  endedAt: true,
  orderedBy: true,
  orderedAt: true,
  verifiedBy: true,
  verifiedAt: true,
  dietType: { select: { id: true, code: true, name: true } },
} as const;

/**
 * S07 · Gizi (rencana fase 4 §4.9, ADR-0105): order diet per kunjungan (satu aktif; order baru menutup yang lama),
 * daftar makan per bangsal × jam makan = label makanan (dicetak dari layar), dan layanan makan + sisa makanan
 * (append-only, waktu catat server). Asuhan gizi tetap lewat formulir P07 (layar Asesmen).
 * Akses: ahli gizi/instalasi gizi = tampilan layanan (semua order aktif + 7 hari); perawat/dokter = pasien yang boleh
 * dibukanya (ABAC fase 3).
 */
@Injectable()
export class NutritionService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly diagnosis: DiagnosisService,
  ) {}

  async dietTypes(): Promise<DietTypeOption[]> {
    return this.db.tx().dietType.findMany({
      where: { active: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true },
    });
  }

  /** Kunjungan untuk order diet: berjalan, kelas dilayani dapur, dan boleh dibuka pelaku. */
  private async encounterFor(encounterId: string) {
    const enc = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, patientId: true, status: true, encounterClass: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(scope, this.access, enc.patientId, enc.status === 'in_progress');
    return enc;
  }

  async listForEncounter(encounterId: string): Promise<DietOrderRecord[]> {
    const enc = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: { id: true, patientId: true, status: true, endedAt: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(
      scope,
      this.access,
      enc.patientId,
      inSupportWindow(enc.status === 'in_progress', enc.endedAt),
    );
    const rows = await this.db.tx().dietOrder.findMany({
      where: { encounterId },
      orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
      select: ORDER_SELECT,
    });
    this.db.audit({ action: 'read', resourceType: 'diet_order', patientId: enc.patientId });
    return this.toRecords(rows);
  }

  async order(input: DietOrderInput): Promise<DietOrderRecord> {
    const me = this.records.author();
    const enc = await this.encounterFor(input.encounterId);
    if (enc.status !== 'in_progress' || !SERVED_CLASSES.has(enc.encounterClass)) {
      throw new AppError(
        'CONFLICT',
        'Order diet hanya untuk kunjungan rawat inap/IGD yang sedang berjalan',
        409,
      );
    }
    const tx = this.db.tx();
    const type = await tx.dietType.findUnique({ where: { id: input.dietTypeId }, select: { active: true } });
    if (!type?.active) {
      throw new AppError('VALIDATION_FAILED', 'Jenis diet tidak ditemukan atau nonaktif', 422, {
        fields: ['dietTypeId'],
      });
    }
    // Satu diet aktif per kunjungan (indeks unik parsial): kunci kunjungan, tutup order lama, lalu buat yang baru.
    await tx.$queryRaw`SELECT id FROM encounters WHERE tenant_id = ${this.db.tenantId()}::uuid AND id = ${enc.id}::uuid FOR UPDATE`;
    const previous = await tx.dietOrder.findMany({
      where: { encounterId: enc.id, status: 'aktif' },
      select: { id: true },
    });
    if (previous.length > 0) {
      await tx.dietOrder.updateMany({
        where: { id: { in: previous.map((p) => p.id) }, status: 'aktif' },
        data: { status: 'selesai', endedAt: new Date() },
      });
    }
    const row = await tx.dietOrder.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId: enc.id,
        patientId: enc.patientId,
        dietTypeId: input.dietTypeId,
        texture: input.texture,
        notes: input.notes,
        startsOn: dbDateFromIso(input.startsOn),
        orderedBy: me.userId,
      },
      select: ORDER_SELECT,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'diet_order',
      resourceId: row.id,
      patientId: enc.patientId,
      details: { encounterId: enc.id, replaced: previous.length },
    });
    return (await this.toRecords([row]))[0] as DietOrderRecord;
  }

  async end(id: string): Promise<DietOrderRecord> {
    this.records.author();
    const tx = this.db.tx();
    const order = await tx.dietOrder.findUnique({ where: { id }, select: ORDER_SELECT });
    if (!order) throw new AppError('NOT_FOUND', 'Order diet tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(
      scope,
      this.access,
      order.patientId,
      inSupportWindow(order.status === 'aktif', order.endedAt),
    );
    if (order.status !== 'aktif') throw new AppError('CONFLICT', 'Order diet sudah selesai', 409);
    const row = await tx.dietOrder.update({
      where: { id },
      data: { status: 'selesai', endedAt: new Date() },
      select: ORDER_SELECT,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'diet_order',
      resourceId: id,
      patientId: order.patientId,
    });
    return (await this.toRecords([row]))[0] as DietOrderRecord;
  }

  /**
   * Daftar makan per jam makan: order diet aktif (mulai ≤ tanggal) dari kunjungan berjalan, per unit tempat pasien
   * kini, beserta layanan makan terakhir untuk tanggal + jam makan itu. Saringan ABAC di SQL sebelum batas baris.
   */
  async mealList(q: MealListQuery): Promise<MealList> {
    const tx = this.db.tx();
    const now = new Date();
    const scope = await supportScope(this.db, this.access);
    const base = { serverNow: now.toISOString(), view: scope.view, date: q.date, meal: q.meal };
    if ('none' in scope) return { ...base, units: [], rows: [] };
    const abac = scope.view === 'ruangan' ? Prisma.sql`AND ${scope.filter}` : Prisma.empty;
    const ids = await tx.$queryRaw<Array<{ id: string; encounter_id: string }>>`
      SELECT d.id::text AS id, d.encounter_id::text AS encounter_id
      FROM diet_orders d
      JOIN encounters e ON e.tenant_id = d.tenant_id AND e.id = d.encounter_id
      JOIN patients p ON p.tenant_id = d.tenant_id AND p.id = d.patient_id
      WHERE d.status = 'aktif' AND d.starts_on <= ${dbDateFromIso(q.date)}::date AND e.status = 'in_progress' ${abac}
      ORDER BY d.ordered_at, d.id
      LIMIT ${MAX_ROWS}`;
    const orders = await tx.dietOrder.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      select: ORDER_SELECT,
    });
    const patients = await patientsLite(
      tx,
      ids.map((r) => r.encounter_id),
    );
    const dayStart = new Date(Date.parse(`${q.date}T00:00:00+07:00`));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const services = await tx.mealService.findMany({
      where: {
        dietOrderId: { in: orders.map((o) => o.id) },
        meal: q.meal,
        servedAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
    const encounterIds = [...new Set(orders.map((o) => o.encounterId))];
    const [npos, screenings] = await Promise.all([
      tx.dietNpoOrder.findMany({
        where: { encounterId: { in: encounterIds }, liftedAt: null },
        select: { encounterId: true, reason: true, plannedUntil: true },
      }),
      tx.nutritionScreening.findMany({
        where: { encounterId: { in: encounterIds } },
        orderBy: [{ screenedAt: 'desc' }, { id: 'desc' }],
        distinct: ['encounterId'],
        select: { encounterId: true, score: true, atRisk: true, screenedAt: true },
      }),
    ]);
    const names = await userNames(
      tx,
      services.map((s) => s.recordedBy),
    );
    const allRows: MealListRow[] = [];
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const o of orders) {
      const patient = patients.get(o.encounterId);
      if (!patient) continue;
      if (patient.unitId) {
        const c = counts.get(patient.unitId) ?? {
          id: patient.unitId,
          name: patient.unitName ?? '–',
          count: 0,
        };
        c.count += 1;
        counts.set(patient.unitId, c);
      }
      if (q.unitId && patient.unitId !== q.unitId) continue;
      const svc = services.find((s) => s.dietOrderId === o.id);
      const allergies = await this.diagnosis.allergiesOf(o.patientId);
      const { unitId, ...lite } = patient;
      allRows.push({
        dietOrderId: o.id,
        encounterId: o.encounterId,
        patient: lite,
        unitId,
        dietType: o.dietType,
        texture: o.texture as MealListRow['texture'],
        notes: o.notes,
        allergies: allergies.status === 'ada' ? allergyLabels(allergies) : [],
        service: svc ? this.toService(svc, names) : null,
        verified: o.verifiedBy !== null,
        npo: (() => {
          const n = npos.find((x) => x.encounterId === o.encounterId);
          return n ? { reason: n.reason, plannedUntil: n.plannedUntil?.toISOString() ?? null } : null;
        })(),
        screening: (() => {
          const sc = screenings.find((x) => x.encounterId === o.encounterId);
          return sc ? { score: sc.score, atRisk: sc.atRisk, screenedAt: sc.screenedAt.toISOString() } : null;
        })(),
      });
    }
    allRows.sort(
      (a, b) =>
        (a.patient.unitName ?? '').localeCompare(b.patient.unitName ?? '') ||
        (a.patient.bed ?? '~').localeCompare(b.patient.bed ?? '~', 'id', { numeric: true }) ||
        a.patient.name.localeCompare(b.patient.name),
    );
    for (const pid of new Set(orders.map((o) => o.patientId))) {
      this.db.audit({ action: 'read', resourceType: 'meal_list', patientId: pid });
    }
    return {
      ...base,
      units: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name)),
      rows: allRows,
    };
  }

  /** Layanan makan / sisa makanan (append-only): baris terbaru per order × jam makan × tanggal berlaku. */
  async recordMeal(input: MealServiceInput): Promise<MealServiceRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const order = await tx.dietOrder.findUnique({
      where: { id: input.dietOrderId },
      select: { id: true, patientId: true, status: true, startsOn: true, endedAt: true },
    });
    if (!order) throw new AppError('NOT_FOUND', 'Order diet tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(
      scope,
      this.access,
      order.patientId,
      inSupportWindow(order.status === 'aktif', order.endedAt),
    );
    if (order.status !== 'aktif') throw new AppError('CONFLICT', 'Order diet sudah selesai', 409);
    const servedAt = new Date(input.servedAt);
    if (servedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new AppError('VALIDATION_FAILED', 'Waktu antar tidak boleh di masa depan', 422, {
        fields: ['servedAt'],
      });
    }
    if (isoDateJakarta(servedAt) < isoFromDbDate(order.startsOn)) {
      throw new AppError('VALIDATION_FAILED', 'Waktu antar sebelum diet mulai berlaku', 422, {
        fields: ['servedAt'],
      });
    }
    const row = await supportWrite(() =>
      tx.mealService.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          dietOrderId: order.id,
          meal: input.meal,
          servedAt,
          leftover: input.leftover,
          recordedBy: me.userId,
        },
      }),
    );
    this.db.audit({
      action: 'create',
      resourceType: 'meal_service',
      resourceId: row.id,
      patientId: order.patientId,
      details: { meal: input.meal, leftover: input.leftover },
    });
    return this.toService(row, await userNames(tx, [row.recordedBy]));
  }

  private toService(
    s: {
      id: string;
      dietOrderId: string;
      meal: string;
      servedAt: Date;
      leftover: string | null;
      recordedBy: string;
      recordedAt: Date;
    },
    names: Map<string, string>,
  ): MealServiceRecord {
    return {
      id: s.id,
      dietOrderId: s.dietOrderId,
      meal: s.meal as MealServiceRecord['meal'],
      servedAt: s.servedAt.toISOString(),
      leftover: s.leftover as MealServiceRecord['leftover'],
      recordedBy: { id: s.recordedBy, name: names.get(s.recordedBy) ?? '–' },
      recordedAt: s.recordedAt.toISOString(),
    };
  }

  private async toRecords(rows: OrderRow[]): Promise<DietOrderRecord[]> {
    const names = await userNames(
      this.db.tx(),
      rows.flatMap((r) => [r.orderedBy, r.verifiedBy]),
    );
    return rows.map((r) => ({
      id: r.id,
      encounterId: r.encounterId,
      patientId: r.patientId,
      dietType: r.dietType,
      texture: r.texture as DietOrderRecord['texture'],
      notes: r.notes,
      startsOn: isoFromDbDate(r.startsOn),
      status: r.status as DietOrderRecord['status'],
      endedAt: r.endedAt?.toISOString() ?? null,
      orderedBy: { id: r.orderedBy, name: names.get(r.orderedBy) ?? '–' },
      orderedAt: r.orderedAt.toISOString(),
      verifiedBy: r.verifiedBy ? { id: r.verifiedBy, name: names.get(r.verifiedBy) ?? '–' } : null,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
    }));
  }

  // ─── 4.9b (ADR-0106): skrining MST, puasa, verifikasi order diet ─────────────────────────────────────────

  /** Order diet + puasa + skrining satu kunjungan (terbaru dulu). */
  async encounterNutrition(encounterId: string): Promise<EncounterNutrition> {
    const orders = await this.listForEncounter(encounterId);
    const tx = this.db.tx();
    const [npo, screenings] = await Promise.all([
      tx.dietNpoOrder.findMany({ where: { encounterId }, orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }] }),
      tx.nutritionScreening.findMany({
        where: { encounterId },
        orderBy: [{ screenedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const names = await userNames(tx, [
      ...npo.flatMap((n) => [n.orderedBy, n.liftedBy]),
      ...screenings.map((x) => x.screenedBy),
    ]);
    return {
      orders,
      npo: npo.map((n) => this.toNpo(n, names)),
      screenings: screenings.map((x) => this.toScreening(x, names)),
    };
  }

  /** Skrining MST (append-only); skor dihitung server dan diperiksa ulang CHECK database. */
  async screen(input: NutritionScreeningInput): Promise<NutritionScreeningRecord> {
    const me = this.records.author();
    const enc = await this.encounterFor(input.encounterId);
    if (enc.status !== 'in_progress') {
      throw new AppError('CONFLICT', 'Skrining gizi untuk kunjungan yang sedang berjalan', 409);
    }
    const { score, atRisk } = mstScore(input.weightLoss, input.poorAppetite);
    const row = await this.db.tx().nutritionScreening.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId: enc.id,
        patientId: enc.patientId,
        weightLoss: input.weightLoss,
        poorAppetite: input.poorAppetite,
        score,
        atRisk,
        screenedBy: me.userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'nutrition_screening',
      resourceId: row.id,
      patientId: enc.patientId,
      details: { score, atRisk },
    });
    return this.toScreening(row, await userNames(this.db.tx(), [me.userId]));
  }

  /** Puasa (NPO): satu aktif per kunjungan; makanan tidak diantar sampai dicabut. */
  async startNpo(input: NpoInput): Promise<NpoRecord> {
    const me = this.records.author();
    const enc = await this.encounterFor(input.encounterId);
    if (enc.status !== 'in_progress') {
      throw new AppError('CONFLICT', 'Puasa untuk kunjungan yang sedang berjalan', 409);
    }
    const tx = this.db.tx();
    if (
      await tx.dietNpoOrder.findFirst({
        where: { encounterId: enc.id, liftedAt: null },
        select: { id: true },
      })
    ) {
      throw new AppError('CONFLICT', 'Pasien sudah dalam status puasa', 409);
    }
    const row = await tx.dietNpoOrder.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        encounterId: enc.id,
        patientId: enc.patientId,
        reason: input.reason,
        plannedUntil: input.plannedUntil ? new Date(input.plannedUntil) : null,
        orderedBy: me.userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'diet_npo',
      resourceId: row.id,
      patientId: enc.patientId,
    });
    return this.toNpo(row, await userNames(tx, [me.userId]));
  }

  async liftNpo(id: string): Promise<NpoRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const npo = await tx.dietNpoOrder.findUnique({ where: { id } });
    if (!npo) throw new AppError('NOT_FOUND', 'Order puasa tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(scope, this.access, npo.patientId, npo.liftedAt === null);
    if (npo.liftedAt) throw new AppError('CONFLICT', 'Puasa sudah dicabut', 409);
    const row = await supportWrite(() =>
      tx.dietNpoOrder.update({ where: { id }, data: { liftedBy: me.userId, liftedAt: new Date() } }),
    );
    this.db.audit({ action: 'update', resourceType: 'diet_npo', resourceId: id, patientId: npo.patientId });
    return this.toNpo(row, await userNames(tx, [row.orderedBy, me.userId]));
  }

  /** Verifikasi ahli gizi (`nutrition.verify`): butuh skrining MST kunjungan (trigger). Sekali per order. */
  async verify(id: string): Promise<DietOrderRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const order = await tx.dietOrder.findUnique({ where: { id }, select: ORDER_SELECT });
    if (!order) throw new AppError('NOT_FOUND', 'Order diet tidak ditemukan', 404);
    const scope = await supportScope(this.db, this.access);
    await assertSupportItem(scope, this.access, order.patientId, order.status === 'aktif');
    const row = await supportWrite(() =>
      tx.dietOrder.update({
        where: { id },
        data: { verifiedBy: me.userId, verifiedAt: new Date() },
        select: ORDER_SELECT,
      }),
    );
    this.db.audit({
      action: 'update',
      resourceType: 'diet_order',
      resourceId: id,
      patientId: order.patientId,
      details: { verified: true },
    });
    return (await this.toRecords([row]))[0] as DietOrderRecord;
  }

  private toNpo(
    n: {
      id: string;
      encounterId: string;
      reason: string;
      plannedUntil: Date | null;
      orderedBy: string;
      orderedAt: Date;
      liftedBy: string | null;
      liftedAt: Date | null;
    },
    names: Map<string, string>,
  ): NpoRecord {
    return {
      id: n.id,
      encounterId: n.encounterId,
      reason: n.reason,
      plannedUntil: n.plannedUntil?.toISOString() ?? null,
      orderedBy: { id: n.orderedBy, name: names.get(n.orderedBy) ?? '–' },
      orderedAt: n.orderedAt.toISOString(),
      liftedBy: n.liftedBy ? { id: n.liftedBy, name: names.get(n.liftedBy) ?? '–' } : null,
      liftedAt: n.liftedAt?.toISOString() ?? null,
    };
  }

  private toScreening(
    x: {
      id: string;
      encounterId: string;
      weightLoss: string;
      poorAppetite: boolean;
      score: number;
      atRisk: boolean;
      screenedBy: string;
      screenedAt: Date;
    },
    names: Map<string, string>,
  ): NutritionScreeningRecord {
    return {
      id: x.id,
      encounterId: x.encounterId,
      weightLoss: x.weightLoss as NutritionScreeningRecord['weightLoss'],
      poorAppetite: x.poorAppetite,
      score: x.score,
      atRisk: x.atRisk,
      screenedBy: { id: x.screenedBy, name: names.get(x.screenedBy) ?? '–' },
      screenedAt: x.screenedAt.toISOString(),
    };
  }
}
