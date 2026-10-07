import { Injectable } from '@nestjs/common';
import {
  CHECKLIST_PHASES,
  type ChecklistPhaseId,
  isoDateJakarta,
  type SignatureStatus,
  type SurgeryBoard,
  type SurgeryCaseView,
  unreconciledCountItems,
} from '@simrs/shared';
import { ageYears } from '../../infra/clinical/clinical-context';
import { TenantDb } from '../../infra/tenant-db';
import { SurgeryAccess } from './surgery-access';

/** Jam papan (WIB): 07.00–16.00, sama dengan mockup OK. */
export const OR_DAY_START_MIN = 7 * 60;
export const OR_DAY_END_MIN = 16 * 60;
/** Mulai tepat waktu bila induksi ≤ 15 menit setelah jadwal. */
const ON_TIME_GRACE_MS = 15 * 60_000;
const WAITLIST_DAYS = 14;

type TemplateItem = { code: string; label: string; system?: boolean };
type TemplateItems = Partial<Record<ChecklistPhaseId, TemplateItem[]>>;

const dayStartUtc = (date: string) => new Date(`${date}T00:00:00+07:00`);

/**
 * S06 · Papan kamar operasi per tanggal (WIB): kamar unit OK beserta kasusnya (pasien + alergi + penjamin, tim, daftar
 * tilik dari templat + centang + konfirmasi, peristiwa, hitung, BHP, laporan), KPI utilisasi/on-time/pembatalan dari
 * server, daftar tunggu 14 hari. Lingkup: perawat unit OK melihat semua; dokter hanya kasus berelasi. Setiap pasien
 * yang tampil diaudit `search`.
 */
@Injectable()
export class SurgeryBoardService {
  constructor(
    private readonly db: TenantDb,
    private readonly scope: SurgeryAccess,
  ) {}

  async board(date: string, now: Date = new Date()): Promise<SurgeryBoard> {
    await this.scope.assertUnit();
    const tx = this.db.tx();
    const okUnit = await this.scope.okUnitId();
    const rooms = await tx.location.findMany({
      where: { unitId: okUnit, kind: 'ruang', active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
    const from = dayStartUtc(date);
    const to = new Date(from.getTime() + 86_400_000);
    const all = await tx.surgeryCase.findMany({
      where: { roomId: { in: rooms.map((r) => r.id) }, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, patientId: true, status: true },
    });
    const visibleIds = await this.visibleIds(all);
    const cases = await this.views(
      all.filter((c) => visibleIds.has(c.id) && c.status !== 'batal').map((c) => c.id),
      from,
      now,
    );
    const live = all.filter((c) => c.status !== 'batal');
    const booked = cases.reduce((sum, c) => sum + c.durationMin, 0);
    const capacity = Math.max(1, rooms.length * (OR_DAY_END_MIN - OR_DAY_START_MIN));
    const started = cases.filter((c) => c.events.some((e) => e.kind === 'induksi'));
    const onTime = started.filter((c) => {
      const induction = c.events.find((e) => e.kind === 'induksi');
      return !!induction && Date.parse(induction.at) <= Date.parse(c.startsAt) + ON_TIME_GRACE_MS;
    });
    const waitRows = await tx.surgeryCase.findMany({
      where: {
        status: 'terjadwal',
        startsAt: { gte: to, lt: new Date(to.getTime() + WAITLIST_DAYS * 86_400_000) },
        roomId: { in: rooms.map((r) => r.id) },
      },
      orderBy: { startsAt: 'asc' },
      take: 50,
      select: {
        id: true,
        caseNo: true,
        startsAt: true,
        priority: true,
        procedureName: true,
        patientId: true,
        roomId: true,
        patient: { select: { name: true } },
      },
    });
    const waitVisible = await this.visibleIds(waitRows);
    const waitlist = waitRows
      .filter((w) => waitVisible.has(w.id))
      .map((w) => ({
        id: w.id,
        caseNo: w.caseNo,
        startsAt: w.startsAt.toISOString(),
        roomName: rooms.find((r) => r.id === w.roomId)?.name ?? '',
        patientName: w.patient.name,
        procedureName: w.procedureName,
        priority: w.priority as 'elektif' | 'cito',
      }));
    for (const patientId of new Set([
      ...cases.map((c) => c.patient.id),
      ...waitRows.map((w) => w.patientId),
    ])) {
      this.db.audit({ action: 'search', resourceType: 'surgery_board', patientId });
    }
    return {
      date,
      serverNow: now.toISOString(),
      dayStartMin: OR_DAY_START_MIN,
      dayEndMin: OR_DAY_END_MIN,
      stats: {
        utilizationPercent: Math.min(100, Math.round((booked / capacity) * 100)),
        onTimeStartPercent: started.length ? Math.round((onTime.length / started.length) * 100) : null,
        cancellations: all.length - live.length,
      },
      rooms: rooms.map((r) => ({ ...r, cases: cases.filter((c) => c.roomId === r.id) })),
      waitlist,
    };
  }

  /** Satu kasus (setelah aksi): bentuk sama dengan papan. */
  async one(caseId: string, now: Date = new Date()): Promise<SurgeryCaseView> {
    const row = await this.db.tx().surgeryCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { startsAt: true },
    });
    const [view] = await this.views([caseId], dayStartUtc(isoDateJakarta(row.startsAt)), now);
    if (!view) throw new Error('kasus operasi hilang');
    return view;
  }

  private async visibleIds(rows: Array<{ id: string; patientId: string }>): Promise<Set<string>> {
    const me = this.db.actorUserId();
    const team = me
      ? await this.db.tx().surgeryCaseTeam.findMany({
          where: { surgeryCaseId: { in: rows.map((r) => r.id) }, userId: me, endedAt: null },
          select: { surgeryCaseId: true },
        })
      : [];
    const teamIds = new Set(team.map((t) => t.surgeryCaseId));
    const out = new Set<string>();
    for (const r of rows) if (await this.scope.visible(r, teamIds)) out.add(r.id);
    return out;
  }

  private async views(ids: string[], dayStart: Date, now: Date): Promise<SurgeryCaseView[]> {
    if (ids.length === 0) return [];
    const tx = this.db.tx();
    const today = isoDateJakarta(now);
    const rows = await tx.surgeryCase.findMany({
      where: { id: { in: ids } },
      orderBy: { startsAt: 'asc' },
      include: {
        patient: { select: { id: true, name: true, mrn: true, sex: true, birthDate: true } },
        checklistTemplate: { select: { items: true } },
        team: { where: { endedAt: null }, include: { user: { select: { displayName: true } } } },
        checks: { include: { checker: { select: { displayName: true } } } },
        confirmations: { include: { confirmer: { select: { displayName: true } } } },
        events: { include: { recorder: { select: { displayName: true } } } },
        counts: { orderBy: [{ countedAt: 'asc' }, { id: 'asc' }] },
        discrepancies: { orderBy: { recordedAt: 'asc' } },
        supplyUsages: {
          include: {
            stockMovement: {
              select: {
                quantity: true,
                stockBatch: { select: { batchNo: true, drug: { select: { name: true } } } },
              },
            },
          },
        },
        reports: {
          where: { status: 'final', addendumOf: null, supersededBy: { none: {} } },
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          include: { author: { select: { displayName: true } } },
        },
      },
    });
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const encounterIds = [...new Set(rows.map((r) => r.encounterId))];
    const [allergies, coverages, consents, docs] = await Promise.all([
      tx.allergyIntolerance.findMany({
        where: {
          patientId: { in: patientIds },
          status: 'final',
          supersededBy: { none: {} },
          addendumOf: null,
        },
        select: { patientId: true, text: true, substance: { select: { name: true } } },
      }),
      tx.coverage.findMany({
        where: { encounterId: { in: encounterIds }, status: 'active' },
        orderBy: { priority: 'asc' },
        select: { encounterId: true, payer: { select: { name: true } } },
      }),
      this.activeConsents(encounterIds),
      tx.document.findMany({
        where: {
          sourceType: 'operative_reports',
          sourceId: { in: rows.flatMap((r) => r.reports.map((x) => x.id)) },
          voidedAt: null,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          sourceId: true,
          signatures: {
            orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { status: true },
          },
        },
      }),
    ]);
    return rows.map((r) => {
      const items = r.checklistTemplate.items as TemplateItems;
      const counts = new Map<string, { label: string; expected: number; final: number | null }>();
      for (const c of r.counts) {
        const cur = counts.get(c.itemCode) ?? { label: c.label, expected: 0, final: null };
        if (c.kind === 'akhir') cur.final = c.quantity;
        else cur.expected += c.quantity;
        counts.set(c.itemCode, cur);
      }
      const resolved = r.discrepancies.map((d) => d.itemCode);
      const consent = consents.get(r.encounterId) ?? null;
      const report = r.reports[0];
      const doc = report ? docs.find((d) => d.sourceId === report.id) : undefined;
      return {
        id: r.id,
        caseNo: r.caseNo,
        encounterId: r.encounterId,
        roomId: r.roomId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        startMin: Math.round((r.startsAt.getTime() - dayStart.getTime()) / 60_000),
        durationMin: Math.max(1, Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000)),
        status: r.status as SurgeryCaseView['status'],
        priority: r.priority as SurgeryCaseView['priority'],
        procedureName: r.procedureName,
        procedureCode: r.procedureCode,
        patient: {
          id: r.patient.id,
          name: r.patient.name,
          rm: r.patient.mrn,
          sex: r.patient.sex as SurgeryCaseView['patient']['sex'],
          ageYears: ageYears(r.patient.birthDate, today),
          birthDate: r.patient.birthDate ? r.patient.birthDate.toISOString().slice(0, 10) : null,
          allergies: allergies
            .filter((a) => a.patientId === r.patientId)
            .map((a) => a.substance?.name ?? a.text ?? 'Alergi')
            .filter((v, i, arr) => arr.indexOf(v) === i),
          guarantor: coverages.find((c) => c.encounterId === r.encounterId)?.payer.name ?? null,
        },
        team: r.team.map((t) => ({
          userId: t.userId,
          name: t.user.displayName,
          role: t.role as SurgeryCaseView['team'][number]['role'],
        })),
        consent,
        checklist: CHECKLIST_PHASES.map((phase) => {
          const conf = r.confirmations.find((c) => c.phase === phase);
          return {
            phase,
            items: (items[phase] ?? []).map((i) => {
              const check = r.checks.find((k) => k.phase === phase && k.itemCode === i.code);
              return {
                code: i.code,
                label: i.label,
                system: !!i.system,
                checked: !!check,
                checkedBy: check?.checker.displayName ?? null,
              };
            }),
            confirmedAt: conf?.confirmedAt.toISOString() ?? null,
            confirmedBy: conf?.confirmer.displayName ?? null,
          };
        }),
        events: r.events
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
          .map((e) => ({
            kind: e.kind as SurgeryCaseView['events'][number]['kind'],
            at: e.occurredAt.toISOString(),
            by: e.recorder.displayName,
            overrideReason: e.overrideReason,
          })),
        counts: [...counts.entries()].map(([itemCode, v]) => ({
          itemCode,
          label: v.label,
          expected: v.expected,
          final: v.final,
          resolution: r.discrepancies.filter((d) => d.itemCode === itemCode).at(-1)?.action ?? null,
        })),
        unreconciled: unreconciledCountItems(
          r.counts.map((c) => ({
            itemCode: c.itemCode,
            kind: c.kind as 'awal' | 'tambahan' | 'akhir',
            quantity: c.quantity,
          })),
          resolved,
        ),
        supplies: r.supplyUsages.map((s) => ({
          id: s.id,
          name: s.stockMovement.stockBatch.drug.name,
          batchNo: s.stockMovement.stockBatch.batchNo,
          quantity: Math.abs(s.stockMovement.quantity),
          implant: s.implant,
        })),
        report: report
          ? {
              id: report.id,
              version: report.version,
              recordedAt: report.recordedAt.toISOString(),
              author: report.author.displayName,
              postOpDiagnosis: report.postOpDiagnosis as { icd10: string; label: string },
              procedureCodes: report.procedureCodes,
              signatureStatus: (doc?.signatures[0]?.status as SignatureStatus | undefined) ?? null,
              documentId: doc?.id ?? null,
            }
          : null,
        cancelReason: r.cancelReason,
      };
    });
  }

  /**
   * Persetujuan tindakan (3.7) yang berlaku per kunjungan: versi `setuju` final terkini yang tidak digantikan dan tidak
   * dicabut (addendum `dicabut`). Finalisasi 3.7 sudah menuntut tanda tangan pasien/wali + saksi + TTE dokter.
   */
  async activeConsents(
    encounterIds: string[],
  ): Promise<Map<string, { id: string; procedure: string; decidedAt: string }>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await this.db.tx().consent.findMany({
      where: {
        encounterId: { in: encounterIds },
        decision: 'setuju',
        status: 'final',
        addendumOf: null,
        supersededBy: { none: {} },
        addenda: { none: { decision: 'dicabut', status: 'final' } },
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, encounterId: true, procedure: true, recordedAt: true },
    });
    const out = new Map<string, { id: string; procedure: string; decidedAt: string }>();
    for (const r of rows) {
      if (!out.has(r.encounterId)) {
        out.set(r.encounterId, { id: r.id, procedure: r.procedure, decidedAt: r.recordedAt.toISOString() });
      }
    }
    return out;
  }
}
