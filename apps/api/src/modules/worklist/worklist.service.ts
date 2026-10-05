import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  ACTIVE_ENCOUNTER_STATUSES,
  AppError,
  ewsNeedsEscalation,
  ewsRisk,
  type Worklist,
  type WorklistPatient,
  type WorklistTask,
  type WorklistView,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

const CURRENT = { supersededBy: { none: {} } } as const;
const HOUR_MS = 3_600_000;
/** Serah terima yang masih relevan untuk tampilan shift/tugas. */
const HANDOVER_WINDOW_HOURS = 12;
/** Resume yang belum final dicari dari kunjungan selesai dalam rentang ini. */
const RESUME_LOOKBACK_DAYS = 30;
const MAX_ENCOUNTERS = 200;
const ATTESTING_TEAM_ROLES = ['dpjp_utama', 'rawat_bersama'];

interface EncounterRow {
  id: string;
  patientId: string;
  number: string;
  encounterClass: string;
  unitName: string;
  bed: string | null;
  patientName: string;
  mrn: string;
}

/**
 * K01 · Worklist klinis (rencana fase 3 §3.2b): satu daftar tugas pribadi + daftar pasien per tampilan.
 * - `dpjp`: kunjungan aktif tempat saya DPJP utama/rawat bersama (tim perawatan) atau DPJP kunjungan;
 * - `unit`: kunjungan aktif yang kini berada di unit penugasan (bed, atau unit kunjungan bila tanpa bed);
 * - `shift`: pasien unit + serah terima untuk saya 12 jam terakhir;
 * - `tugas`: daftar tugas saja.
 * Tugas: co-sign CPPT residen, verifikasi CPPT PPA lain lewat `cppt.verify_hours` sejak waktu kejadian (tidak
 * memblokir, keputusan no. 5),
 * tinjau order residen, TTE saya yang gagal, EWS tinggi, resume rawat inap lewat `resume.deadline_hours`, serah
 * terima untuk saya. Setiap pasien yang tampil disaring ABAC dan diaudit `read` per pasien.
 */
@Injectable()
export class WorklistService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
  ) {}

  async get(view: WorklistView): Promise<Worklist> {
    const me = this.db.actorUserId();
    if (!me) throw new AppError('FORBIDDEN', 'Worklist hanya untuk staf yang masuk', 403);
    const now = new Date();
    const tx = this.db.tx();
    const [verifyHours, resumeHours, ewsThreshold] = await Promise.all([
      readTenantSetting(tx, 'cppt.verify_hours'),
      readTenantSetting(tx, 'resume.deadline_hours'),
      readTenantSetting(tx, 'ews.escalation_score'),
    ]);

    const dpjpIds = await this.dpjpEncounterIds(me);
    const unitIds = view === 'unit' || view === 'shift' ? await this.unitEncounterIds() : [];
    const shown = view === 'dpjp' ? dpjpIds : view === 'tugas' ? [] : unitIds;
    const relevant = [...new Set([...dpjpIds, ...unitIds])];
    const encounters = await this.encounters(relevant);
    const byId = new Map(encounters.map((e) => [e.id, e]));

    const tasks: WorklistTask[] = [];
    const push = (
      e: EncounterRow | undefined,
      t: Omit<WorklistTask, 'encounterId' | 'patientId' | 'patientName' | 'mrn'>,
    ) => {
      if (e)
        tasks.push({
          ...t,
          encounterId: e.id,
          patientId: e.patientId,
          patientName: e.patientName,
          mrn: e.mrn,
        });
    };

    // Co-sign + verifikasi (hanya kunjungan tempat saya DPJP/rawat bersama).
    if (dpjpIds.length > 0) {
      const entries = await tx.cpptEntry.findMany({
        where: { encounterId: { in: dpjpIds }, status: 'final', authorUserId: { not: me }, ...CURRENT },
        select: {
          id: true,
          encounterId: true,
          ppa: true,
          cosignRequired: true,
          occurredAt: true,
          recordedAt: true,
        },
      });
      const attested = await tx.clinicalAttestation.findMany({
        where: {
          targetType: 'cppt_entries',
          targetId: { in: entries.map((e) => e.id) },
          kind: { in: ['cosign', 'verify'] },
        },
        select: { targetId: true, kind: true },
      });
      const has = (id: string, kind: string) => attested.some((a) => a.targetId === id && a.kind === kind);
      for (const c of entries) {
        if (c.cosignRequired && !has(c.id, 'cosign')) {
          push(byId.get(c.encounterId), {
            kind: 'cosign',
            targetId: c.id,
            at: c.recordedAt.toISOString(),
            dueAt: null,
            overdue: false,
            label: 'Co-sign CPPT residen',
          });
        } else if (!c.cosignRequired && c.ppa !== 'dpjp' && !has(c.id, 'verify')) {
          // Batas dihitung dari waktu kejadian (catatan susulan tidak memperpanjang batas verifikasi).
          const due = new Date(c.occurredAt.getTime() + verifyHours * HOUR_MS);
          if (due <= now) {
            push(byId.get(c.encounterId), {
              kind: 'verify',
              targetId: c.id,
              at: c.occurredAt.toISOString(),
              dueAt: due.toISOString(),
              overdue: true,
              label: `Verifikasi CPPT ${c.ppa} lewat ${verifyHours} jam`,
            });
          }
        }
      }
      const orders = await tx.orderGroup.findMany({
        where: { encounterId: { in: dpjpIds }, needsReview: true },
        select: { id: true, encounterId: true, orderedAt: true },
      });
      const reviewed = await tx.clinicalAttestation.findMany({
        where: {
          targetType: 'order_groups',
          targetId: { in: orders.map((o) => o.id) },
          kind: 'review_order',
        },
        select: { targetId: true },
      });
      for (const o of orders) {
        if (reviewed.some((r) => r.targetId === o.id)) continue;
        push(byId.get(o.encounterId), {
          kind: 'review_order',
          targetId: o.id,
          at: o.orderedAt.toISOString(),
          dueAt: null,
          overdue: false,
          label: 'Tinjau order residen',
        });
      }
    }

    // EWS tinggi: observasi tanda vital terkini per kunjungan yang relevan.
    if (relevant.length > 0) {
      const vitals = await tx.observation.findMany({
        where: {
          encounterId: { in: relevant },
          category: 'vital',
          status: 'final',
          ewsScore: { not: null },
          ...CURRENT,
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        distinct: ['encounterId'],
        select: { id: true, encounterId: true, ewsScore: true, ewsMaxParam: true, occurredAt: true },
      });
      for (const v of vitals) {
        const score = v.ewsScore ?? 0;
        const max = v.ewsMaxParam ?? 0;
        const enc = byId.get(v.encounterId);
        if (enc) enc.ews = { score, risk: ewsRisk(score, max).level, at: v.occurredAt.toISOString() };
        if (ewsNeedsEscalation(score, max, ewsThreshold)) {
          push(enc, {
            kind: 'ews_high',
            targetId: v.id,
            at: v.occurredAt.toISOString(),
            dueAt: null,
            overdue: false,
            label: `EWS ${score} (${ewsRisk(score, max).level})`,
          });
        }
      }
    }

    // TTE saya yang gagal.
    const failed = await tx.documentSignature.findMany({
      where: { signerUserId: me, status: 'failed', document: { voidedAt: null } },
      select: {
        documentId: true,
        requestedAt: true,
        document: { select: { title: true, patient: { select: { id: true, name: true, mrn: true } } } },
      },
      take: 50,
    });
    for (const f of failed) {
      tasks.push({
        kind: 'tte_failed',
        encounterId: null,
        patientId: f.document.patient.id,
        patientName: f.document.patient.name,
        mrn: f.document.patient.mrn,
        targetId: f.documentId,
        at: f.requestedAt.toISOString(),
        dueAt: null,
        overdue: true,
        label: `TTE gagal: ${f.document.title}`,
      });
    }

    // Resume rawat inap lewat batas (kunjungan selesai tempat saya DPJP).
    const finished = await tx.encounter.findMany({
      where: {
        encounterClass: 'IMP',
        status: 'finished',
        endedAt: {
          gte: new Date(now.getTime() - RESUME_LOOKBACK_DAYS * 86_400_000),
          lte: new Date(now.getTime() - resumeHours * HOUR_MS),
        },
        OR: [
          { participants: { some: { userId: me, role: { in: ATTESTING_TEAM_ROLES } } } },
          { practitioner: { userId: me } },
        ],
        dischargeSummaries: { none: { status: 'final', supersededBy: { none: {} } } },
      },
      select: { id: true, endedAt: true },
      take: 50,
    });
    const finishedRows = await this.encounters(finished.map((f) => f.id));
    for (const f of finished) {
      const ended = f.endedAt as Date;
      push(
        finishedRows.find((r) => r.id === f.id),
        {
          kind: 'resume_overdue',
          targetId: null,
          at: ended.toISOString(),
          dueAt: new Date(ended.getTime() + resumeHours * HOUR_MS).toISOString(),
          overdue: true,
          label: `Resume belum final lewat ${resumeHours} jam`,
        },
      );
    }

    // Serah terima untuk saya.
    if (view === 'shift' || view === 'tugas') {
      const handovers = await tx.handover.findMany({
        where: {
          toUserId: me,
          status: 'final',
          occurredAt: { gte: new Date(now.getTime() - HANDOVER_WINDOW_HOURS * HOUR_MS) },
          ...CURRENT,
        },
        select: { id: true, encounterId: true, occurredAt: true },
      });
      const rows = await this.encounters(handovers.map((h) => h.encounterId));
      for (const h of handovers) {
        push(
          rows.find((r) => r.id === h.encounterId),
          {
            kind: 'handover',
            targetId: h.id,
            at: h.occurredAt.toISOString(),
            dueAt: null,
            overdue: false,
            label: 'Serah terima untuk Anda',
          },
        );
      }
    }

    // ABAC: hanya pasien yang boleh dibuka pelaku; satu audit `read` per pasien yang tampil.
    const allowed = new Map<string, boolean>();
    for (const pid of new Set([
      ...tasks.map((t) => t.patientId),
      ...shown.map((id) => byId.get(id)?.patientId),
    ])) {
      if (pid) allowed.set(pid, (await this.access.basis(pid)) !== null);
    }
    const visibleTasks = tasks
      .filter((t) => allowed.get(t.patientId))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.at.localeCompare(b.at));
    const patients: WorklistPatient[] = shown
      .map((id) => byId.get(id))
      .filter((e): e is EncounterRow & { ews?: WorklistPatient['ews'] } => !!e && !!allowed.get(e.patientId))
      .map((e) => ({
        encounterId: e.id,
        patientId: e.patientId,
        name: e.patientName,
        mrn: e.mrn,
        encounterNumber: e.number,
        class: e.encounterClass as WorklistPatient['class'],
        unitName: e.unitName,
        bed: e.bed,
        ews: (e as { ews?: WorklistPatient['ews'] }).ews ?? null,
        pendingTasks: visibleTasks.filter((t) => t.encounterId === e.id).length,
      }));
    for (const pid of new Set([
      ...visibleTasks.map((t) => t.patientId),
      ...patients.map((p) => p.patientId),
    ])) {
      this.db.audit({ action: 'read', resourceType: 'worklist', patientId: pid, details: { view } });
    }
    return { view, generatedAt: now.toISOString(), patients, tasks: visibleTasks };
  }

  private async dpjpEncounterIds(me: string): Promise<string[]> {
    const rows = await this.db.tx().encounter.findMany({
      where: {
        status: { in: [...ACTIVE_ENCOUNTER_STATUSES] },
        OR: [
          { participants: { some: { userId: me, endedAt: null, role: { in: ATTESTING_TEAM_ROLES } } } },
          { practitioner: { userId: me } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_ENCOUNTERS,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Kunjungan aktif yang kini berada di unit penugasan sesi (unit bed terbuka, atau unit kunjungan tanpa bed). */
  private async unitEncounterIds(): Promise<string[]> {
    const unitId = this.db.actor().unitId;
    if (!unitId) return [];
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT e.id::text AS id FROM encounters e
      LEFT JOIN bed_assignments ba ON ba.tenant_id = e.tenant_id AND ba.encounter_id = e.id AND ba.ended_at IS NULL
      LEFT JOIN locations l ON l.tenant_id = ba.tenant_id AND l.id = ba.location_id
      WHERE e.status IN ('planned', 'arrived', 'in_progress') AND coalesce(l.unit_id, e.unit_id) = ${unitId}::uuid
      ORDER BY e.created_at, e.id
      LIMIT ${MAX_ENCOUNTERS}`;
    return rows.map((r) => r.id);
  }

  private async encounters(ids: string[]): Promise<Array<EncounterRow & { ews?: WorklistPatient['ews'] }>> {
    if (ids.length === 0) return [];
    const rows = await this.db.tx().encounter.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        patientId: true,
        number: true,
        encounterClass: true,
        unit: { select: { name: true } },
        patient: { select: { name: true, mrn: true } },
        bedAssignments: {
          where: { endedAt: null },
          take: 1,
          select: { location: { select: { code: true } } },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      number: r.number,
      encounterClass: r.encounterClass,
      unitName: r.unit.name,
      bed: r.bedAssignments[0]?.location.code ?? null,
      patientName: r.patient.name,
      mrn: r.patient.mrn,
    }));
  }
}
