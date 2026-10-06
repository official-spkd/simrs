import { Injectable } from '@nestjs/common';
import {
  AppError,
  isoDateJakarta,
  jakartaWallTime,
  type ClinicalEntryMeta,
  type FluidBalanceInput,
  type NursingCarePlanInput,
  type NursingCarePlanRecord,
} from '@simrs/shared';
import { assertRevisionAllowed, clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { SatusehatRecorder } from '../../infra/clinical/staging';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

const CURRENT = { supersededBy: { none: {} }, status: 'final' } as const;

@Injectable()
export class NursingCareService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly matrix: PermissionMatrix,
    private readonly satusehat: SatusehatRecorder,
  ) {}

  async diagnoses() {
    return this.db
      .tx()
      .nursingDiagnosis.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      });
  }

  async recordPlan(input: NursingCarePlanInput): Promise<NursingCarePlanRecord> {
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const diagnosis = await this.db.tx().nursingDiagnosis.findUnique({ where: { id: input.diagnosisId } });
    if (!diagnosis?.active)
      throw new AppError('VALIDATION_FAILED', 'Diagnosis keperawatan tidak dikenal atau nonaktif', 422);
    const f = await this.records.prepare('nursing_care_plans', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    const row = await this.records.insert(() =>
      this.db.tx().nursingCarePlan.create({
        data: {
          ...f,
          encounterId: enc.id,
          diagnosisId: diagnosis.id,
          goals: input.goals,
          interventions: input.interventions,
          evaluation: input.evaluation,
        },
        include: { diagnosis: true },
      }),
    );
    this.db.audit({
      action: input.revision.kind === 'koreksi' ? 'correct' : 'create',
      resourceType: 'nursing_care_plan',
      resourceId: row.id,
      patientId: enc.patientId,
      details: { encounterId: enc.id, version: row.version },
    });
    const meta = (await this.records.meta('nursing_care_plans', [row])).get(row.id) as ClinicalEntryMeta;
    return {
      ...meta,
      encounterId: enc.id,
      diagnosisId: row.diagnosisId,
      diagnosis: row.diagnosis.name,
      goals: row.goals,
      interventions: row.interventions as string[],
      evaluation: row.evaluation,
    };
  }

  async plans(encounterId: string): Promise<NursingCarePlanRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db
      .tx()
      .nursingCarePlan.findMany({
        where: { encounterId: enc.id, ...CURRENT },
        include: { diagnosis: true },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 200,
      });
    const meta = await this.records.meta('nursing_care_plans', rows);
    this.db.audit({
      action: 'read',
      resourceType: 'nursing_care_plan',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      encounterId: enc.id,
      diagnosisId: r.diagnosisId,
      diagnosis: r.diagnosis.name,
      goals: r.goals,
      interventions: r.interventions as string[],
      evaluation: r.evaluation,
    }));
  }

  async recordFluid(input: FluidBalanceInput) {
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    // Kanal observasi cairan tidak boleh dipakai untuk mengoreksi observasi vital/lab.
    if (input.revision.kind !== 'baru') {
      const id = input.revision.kind === 'koreksi' ? input.revision.supersedesId : input.revision.addendumOf;
      const target = await this.db.tx().observation.findUnique({ where: { id }, select: { category: true } });
      if (target?.category !== 'cairan')
        throw new AppError('NOT_FOUND', 'Observasi cairan tidak ditemukan', 404);
    }
    const f = await this.records.prepare('observations', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    const row = await this.records.insert(() =>
      this.db.tx().observation.create({
        data: {
          ...f,
          encounterId: enc.id,
          category: 'cairan',
          display: input.direction === 'intake' ? 'Cairan masuk' : 'Cairan keluar',
          valueNumeric: input.volumeMl,
          valueUnit: 'mL',
          valueText: input.note,
          components: { direction: input.direction, route: input.route },
        },
      }),
    );
    await this.satusehat.record('Observation', row.id, row.version);
    this.db.audit({
      action: input.revision.kind === 'koreksi' ? 'correct' : 'create',
      resourceType: 'observation',
      resourceId: row.id,
      patientId: enc.patientId,
      details: { encounterId: enc.id, category: 'cairan', version: row.version },
    });
    return {
      ...(await this.records.meta('observations', [row])).get(row.id),
      encounterId: enc.id,
      direction: input.direction,
      route: input.route,
      volumeMl: row.valueNumeric?.toNumber(),
      note: row.valueText,
    };
  }

  async fluids(encounterId: string, date = isoDateJakarta(new Date())) {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const from = jakartaWallTime(y, m, d, 0, 0);
    const rows = await this.db
      .tx()
      .observation.findMany({
        where: {
          encounterId: enc.id,
          category: 'cairan',
          ...CURRENT,
          occurredAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
    const meta = await this.records.meta('observations', rows);
    const entries = rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      ...(r.components as { direction: 'intake' | 'output'; route: string }),
      volumeMl: r.valueNumeric?.toNumber() ?? 0,
      note: r.valueText,
    }));
    const intakeMl = entries.filter((e) => e.direction === 'intake').reduce((n, e) => n + e.volumeMl, 0);
    const outputMl = entries.filter((e) => e.direction === 'output').reduce((n, e) => n + e.volumeMl, 0);
    this.db.audit({
      action: 'read',
      resourceType: 'observation',
      patientId: enc.patientId,
      details: { encounterId: enc.id, category: 'cairan', count: entries.length },
    });
    return { encounterId: enc.id, date, entries, intakeMl, outputMl, balanceMl: intakeMl - outputMl };
  }
}
