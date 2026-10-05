import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  type AtsLevel,
  AppError,
  clinicalError,
  type EdBoardApi,
  type EdStatus,
  type EdStatusInput,
  type EdZone,
  encounterClassToken,
  frontOfficeError,
  newId,
  SAFETY_REASON_MIN,
  suggestTriage,
  triageBlockReason,
  type TriageAssessmentInput,
  type TriageAssessmentRecord,
} from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder, SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { minutesSince } from '../adt/adt-helpers';
import { AdtService } from '../adt/adt.service';
import { BedOpsService } from '../adt/bed-ops.service';
import { PatientAccessService } from '../authz/patient-access.service';

const ACTIVE = ['arrived', 'in_progress'] as const;

function ageYears(birthDate: Date | null, now: Date): number | null {
  if (!birthDate) return null;
  const years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  return Math.max(0, years - (beforeBirthday ? 1 : 0));
}

/**
 * K03 · Triase IGD (rencana fase 3 §3.3, keputusan no. 6): saran ATS dihitung SERVER dari tanda vital + diskriminator
 * (`suggestTriage`, `@simrs/shared`), pilihan petugas berversi (`triage_assessments`, ADR-0028). Turun dari saran tanpa
 * alasan ≥ 10 → 422 `TRIAGE_REASON_REQUIRED`; di bawah batas protokol → 422 `TRIAGE_LEVEL_NOT_ALLOWED` (juga CHECK
 * database). Triase pertama memulai pelayanan klinis (`encounter.started`), staging biaya IGD dan SATUSEHAT Encounter.
 * Papan IGD + status alur (`ed_status_events`, penempatan bed IGD).
 */
@Injectable()
export class TriageService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly events: DomainEvents,
    private readonly beds: BedOpsService,
    private readonly adt: AdtService,
    private readonly satusehat: SatusehatRecorder,
    private readonly billable: BillableRecorder,
  ) {}

  async assess(input: TriageAssessmentInput): Promise<TriageAssessmentRecord> {
    const tx = this.db.tx();
    const enc = await this.emergency(input.encounterId);
    await this.access.assert(enc.patientId);
    const now = new Date();
    const patient = await tx.patient.findUniqueOrThrow({
      where: { id: enc.patientId },
      select: { birthDate: true },
    });
    const suggestion = suggestTriage({
      vitals: input.vitals,
      discriminators: input.discriminators,
      ageYears: ageYears(patient.birthDate, now),
    });
    const blocked = triageBlockReason(suggestion, input.chosenLevel, input.overrideReason, SAFETY_REASON_MIN);
    if (blocked)
      throw clinicalError(blocked, { suggestedLevel: suggestion.level, maxLevel: suggestion.maxLevel });
    const f = await this.records.prepare('triage_assessments', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    const overrideReason =
      input.chosenLevel > suggestion.level ? (input.overrideReason?.trim() ?? null) : null;
    await this.records.insert(() =>
      tx.triageAssessment.create({
        data: {
          ...f,
          encounterId: enc.id,
          scale: 'ATS',
          vitals: input.vitals,
          discriminators: [...input.discriminators],
          suggestedLevel: suggestion.level,
          maxLevel: suggestion.maxLevel,
          chosenLevel: input.chosenLevel,
          overrideReason,
          reasons: suggestion.reasons,
        },
      }),
    );
    if (enc.status === 'arrived') {
      await tx.encounter.update({
        where: { id: enc.id },
        data: { status: 'in_progress', startedAt: now, updatedBy: this.db.actorUserId() },
      });
      await tx.encounterStatusHistory.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          encounterId: enc.id,
          fromStatus: 'arrived',
          toStatus: 'in_progress',
          changedBy: this.db.actorUserId(),
        },
      });
      await this.events.publish('encounter.started', {
        encounterId: enc.id,
        patientId: enc.patientId,
        encounterClass: encounterClassToken('EMER'),
        unitId: enc.unitId,
      });
      await this.satusehat.record('Encounter', enc.id, await this.adt.encounterRevision(enc.id));
    }
    await this.billable.record({
      encounterId: enc.id,
      patientId: enc.patientId,
      sourceType: 'encounters',
      sourceId: enc.id,
      kind: 'igd',
      occurredAt: f.occurredAt,
    });
    this.db.audit({
      action: f.version > 1 ? 'correct' : 'create',
      resourceType: 'triage_assessment',
      resourceId: f.id,
      patientId: enc.patientId,
      reason: overrideReason ?? f.correctionReason,
      details: { level: input.chosenLevel, suggested: suggestion.level, override: overrideReason !== null },
    });
    const row = await tx.triageAssessment.findUniqueOrThrow({ where: { id: f.id } });
    const meta = (await this.records.meta('triage_assessments', [row])).get(row.id);
    if (!meta) throw new Error('meta triase hilang');
    return {
      ...meta,
      encounterId: enc.id,
      vitals: input.vitals,
      discriminators: [...input.discriminators],
      suggestedLevel: suggestion.level,
      maxLevel: suggestion.maxLevel,
      chosenLevel: input.chosenLevel,
      overrideReason,
      reasons: suggestion.reasons,
    };
  }

  /** Status alur IGD + zona; `locationId` = bed IGD (penempatan berpindah, bed lama kotor). */
  async setStatus(encounterId: string, input: EdStatusInput) {
    const tx = this.db.tx();
    const enc = await this.emergency(encounterId);
    await this.access.assert(enc.patientId);
    const now = new Date();
    if (input.locationId) {
      const bed = await this.beds.bedByLocation(input.locationId);
      if (bed.unitId !== enc.unitId)
        throw new AppError('VALIDATION_FAILED', 'Bed bukan bed IGD kunjungan ini', 422);
      const open = await tx.bedAssignment.findFirst({ where: { encounterId: enc.id, endedAt: null } });
      if (open?.locationId !== input.locationId) {
        if (bed.status !== 'siap') throw clinicalError('BED_NOT_AVAILABLE');
        const from = await this.beds.endOpenAssignment(enc.id, 'transfer', now);
        await this.beds.assign(enc.id, enc.patientId, input.locationId, now);
        await this.beds.setStatus(bed, 'terisi', { encounterId: enc.id });
        if (from) await this.beds.vacate(from);
      }
    }
    const id = newId();
    await tx.edStatusEvent.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        encounterId: enc.id,
        status: input.status,
        zone: input.zone,
        locationId: input.locationId,
        changedAt: now,
        changedBy: this.db.actorUserId(),
      },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'ed_status',
      resourceId: id,
      patientId: enc.patientId,
      details: { status: input.status, zone: input.zone },
    });
    return { id, encounterId: enc.id, status: input.status, zone: input.zone, at: now.toISOString() };
  }

  /** Papan IGD unit penugasan (atau `unitId` bagi lingkup `all`); setiap pasien yang tampil diaudit `search`. */
  async board(unitId?: string, now: Date = new Date()): Promise<EdBoardApi> {
    const tx = this.db.tx();
    const scope = this.db.permissionScope();
    let target = unitId;
    if (scope !== 'all') {
      const own = this.db.actor().unitId;
      if (!own || (unitId && unitId !== own)) {
        throw new AppError('FORBIDDEN', 'Papan IGD unit lain di luar penugasan', 403);
      }
      target = own;
    }
    const unit = await tx.unit.findFirst({
      where: { kind: 'igd', active: true, ...(target ? { id: target } : {}) },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (!unit) throw new AppError('NOT_FOUND', 'Unit IGD tidak ditemukan', 404);
    const boardingHours = await readTenantSetting(tx, 'bed.boarding_alert_hours');
    const encounters = await tx.encounter.findMany({
      where: { unitId: unit.id, encounterClass: 'EMER', status: { in: [...ACTIVE] } },
      orderBy: { arrivedAt: 'asc' },
      select: {
        id: true,
        number: true,
        arrivedAt: true,
        createdAt: true,
        patient: { select: { id: true, name: true, mrn: true, unidentified: true } },
      },
    });
    const ids = encounters.map((e) => e.id);
    const [statuses, triages, requests, beds] = await Promise.all([
      tx.edStatusEvent.findMany({ where: { encounterId: { in: ids } }, orderBy: { id: 'desc' } }),
      tx.$queryRaw<
        Array<{
          encounter_id: string;
          chosen_level: number;
          suggested_level: number;
          max_level: number;
          occurred_at: Date;
        }>
      >`
        SELECT DISTINCT ON (encounter_id) encounter_id::text, chosen_level, suggested_level, max_level, occurred_at
        FROM triage_assessments_current
        WHERE encounter_id = ANY(${ids}::uuid[]) AND status = 'final'
        ORDER BY encounter_id, occurred_at DESC`,
      tx.bedRequest.findMany({
        where: { encounterId: { in: ids }, status: { in: ['menunggu', 'dialokasi'] } },
      }),
      tx.bedAssignment.findMany({ where: { encounterId: { in: ids }, endedAt: null } }),
    ]);
    const items: EdBoardApi['items'] = encounters.map((e) => {
      const st = statuses.find((s) => s.encounterId === e.id);
      const t = triages.find((x) => x.encounter_id === e.id);
      const r = requests.find((x) => x.encounterId === e.id);
      const wait = r ? minutesSince(r.requestedAt, now) : 0;
      return {
        encounterId: e.id,
        number: e.number,
        patientId: e.patient.id,
        patientName: e.patient.name,
        rm: e.patient.mrn,
        unidentified: e.patient.unidentified,
        arrivedAt: e.arrivedAt?.toISOString() ?? null,
        losMinutes: minutesSince(e.arrivedAt ?? e.createdAt, now),
        status: (st?.status as EdStatus | undefined) ?? null,
        zone: (st?.zone as EdZone | null | undefined) ?? null,
        bedId: beds.find((b) => b.encounterId === e.id)?.locationId ?? null,
        triage: t
          ? {
              level: t.chosen_level as AtsLevel,
              suggestedLevel: t.suggested_level as AtsLevel,
              maxLevel: t.max_level as AtsLevel,
              at: t.occurred_at.toISOString(),
            }
          : null,
        bedRequest: r
          ? {
              status: r.status as 'menunggu' | 'dialokasi',
              waitMinutes: wait,
              boarding: wait >= boardingHours * 60,
            }
          : null,
      };
    });
    for (const i of items) {
      this.db.audit({ action: 'search', resourceType: 'ed_board', patientId: i.patientId });
    }
    return { asOf: now.toISOString(), unitId: unit.id, items };
  }

  private async emergency(encounterId: string) {
    const enc = await this.db.tx().encounter.findUnique({ where: { id: encounterId } });
    if (!enc || enc.encounterClass !== 'EMER')
      throw new AppError('NOT_FOUND', 'Kunjungan IGD tidak ditemukan', 404);
    if (!(ACTIVE as readonly string[]).includes(enc.status)) {
      throw frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, 'Kunjungan IGD tidak aktif');
    }
    return enc;
  }
}
