import { Injectable } from '@nestjs/common';
import { isoFromDbDate } from '@simrs/db';
import {
  AppError,
  type EncounterContext,
  ewsRisk,
  isoDateJakarta,
  MEDICATION_FREQUENCIES,
  type MedicationFrequency,
  type PatientAllergies,
  type PatientBanner,
  type PatientSummary,
} from '@simrs/shared';
import {
  ageYears,
  clinicalEncounter,
  clinicalPatient,
  patientGroupIds,
} from '../../infra/clinical/clinical-context';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { DiagnosisService } from '../diagnosis/diagnosis.service';
import { VitalsService } from '../nursing/vitals.service';
import { ResultsService } from '../results/results.service';

const CURRENT = { supersededBy: { none: {} } } as const;
const CRITICALITY: Record<string, string> = {
  rendah: 'rendah',
  tinggi: 'tinggi',
  tidak_diketahui: 'belum diketahui',
};

/**
 * K14 · Ringkasan pasien dan banner kunjungan (rencana §3.2a). Hanya membaca; semua riwayat lewat kelompok rekam medis
 * (`app_patient_group`, ADR-0016). ABAC per pasien; setiap pembukaan diaudit `read` dengan pasien (bahan temuan
 * "akses pasien rahasia").
 */
@Injectable()
export class SummaryService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly diagnosis: DiagnosisService,
    private readonly results: ResultsService,
    private readonly vitals: VitalsService,
  ) {}

  /** Banner pasien di setiap layar klinis (CLAUDE.md §6): nama, umur, RM, alergi, penjamin, DPJP, lokasi. */
  async context(encounterId: string): Promise<EncounterContext> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const tx = this.db.tx();
    const [row, bed, dpjp, primary, ews, allergies] = await Promise.all([
      tx.encounter.findUniqueOrThrow({
        where: { id: enc.id },
        select: {
          id: true,
          number: true,
          encounterClass: true,
          status: true,
          arrivedAt: true,
          startedAt: true,
          unit: { select: { id: true, name: true } },
          practitioner: { select: { name: true } },
          coverages: {
            where: { status: 'active' },
            orderBy: { priority: 'asc' },
            take: 1,
            select: { payer: { select: { kind: true, name: true } } },
          },
        },
      }),
      tx.bedAssignment.findFirst({
        where: { encounterId: enc.id, endedAt: null },
        select: { location: { select: { id: true, code: true, name: true } } },
      }),
      tx.encounterParticipant.findFirst({
        where: { encounterId: enc.id, role: 'dpjp_utama', endedAt: null },
        select: { user: { select: { displayName: true } } },
      }),
      tx.condition.findFirst({
        where: { encounterId: enc.id, kind: 'encounter', role: 'utama', status: 'final', ...CURRENT },
        select: { code: true, display: true },
      }),
      tx.observation.findFirst({
        where: {
          encounterId: enc.id,
          category: 'vital',
          status: 'final',
          ewsScore: { not: null },
          ...CURRENT,
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { ewsScore: true, ewsMaxParam: true, occurredAt: true },
      }),
      this.diagnosis.allergiesOf(enc.patientId),
    ]);
    const patient = await this.banner(enc.patientId);
    const payer = row.coverages[0]?.payer ?? null;
    this.db.audit({
      action: 'read',
      resourceType: 'encounter_context',
      resourceId: enc.id,
      patientId: enc.patientId,
    });
    return {
      patient,
      encounter: {
        id: row.id,
        number: row.number,
        class: row.encounterClass as EncounterContext['encounter']['class'],
        status: row.status as EncounterContext['encounter']['status'],
        unit: row.unit,
        bed: bed?.location ?? null,
        arrivedAt: row.arrivedAt?.toISOString() ?? null,
        startedAt: row.startedAt?.toISOString() ?? null,
      },
      dpjp: dpjp
        ? { name: dpjp.user.displayName }
        : row.practitioner
          ? { name: row.practitioner.name }
          : null,
      coverage: payer ? { kind: payer.kind, name: payer.name } : null,
      allergy: { status: allergies.status, labels: allergyLabels(allergies) },
      primaryDiagnosis: primary,
      latestEws:
        ews?.ewsScore != null ? ewsSummary(ews.ewsScore, ews.ewsMaxParam ?? 0, ews.occurredAt) : null,
    };
  }

  /** K14 · Ringkasan lintas kunjungan: alergi, masalah aktif, kunjungan, TTV terakhir, hasil, tindakan, obat aktif. */
  async patientSummary(patientId: string): Promise<PatientSummary> {
    await clinicalPatient(this.db, this.access, patientId);
    const tx = this.db.tx();
    const group = await patientGroupIds(tx, patientId);
    const [allergies, problems, encounters, vital, recentResults, procedures, meds] = await Promise.all([
      this.diagnosis.allergiesOf(patientId),
      tx.condition.findMany({
        where: {
          patientId: { in: group },
          kind: 'problem_list',
          clinicalStatus: 'active',
          status: 'final',
          ...CURRENT,
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
      tx.encounter.findMany({
        where: { patientId: { in: group } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          number: true,
          encounterClass: true,
          status: true,
          createdAt: true,
          arrivedAt: true,
          unit: { select: { name: true } },
        },
      }),
      tx.observation.findFirst({
        where: { patientId: { in: group }, category: 'vital', status: 'final', ...CURRENT },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
      this.results.recentObservations(group, 20),
      tx.procedure.findMany({
        where: { patientId: { in: group }, status: 'final', ...CURRENT },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      tx.medicationRequest.findMany({
        where: { patientId: { in: group }, encounter: { status: { notIn: ['finished', 'cancelled'] } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          encounterId: true,
          name: true,
          dose: true,
          route: true,
          frequency: true,
          highAlert: true,
          createdAt: true,
          statusEvents: {
            orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { status: true },
          },
        },
      }),
    ]);
    const primaries = await tx.condition.findMany({
      where: {
        encounterId: { in: encounters.map((e) => e.id) },
        kind: 'encounter',
        role: 'utama',
        status: 'final',
        ...CURRENT,
      },
      select: { encounterId: true, code: true, display: true },
    });
    const primaryOf = new Map(primaries.map((p) => [p.encounterId, { code: p.code, display: p.display }]));
    const latestVital = vital ? (await this.vitals.present([vital]))[0] : undefined;
    this.db.audit({ action: 'read', resourceType: 'patient_summary', resourceId: patientId, patientId });
    return {
      patient: await this.banner(patientId),
      allergies,
      activeProblems: await this.diagnosis.presentConditions(problems),
      encounters: encounters.map((e) => ({
        id: e.id,
        number: e.number,
        class: e.encounterClass as PatientSummary['encounters'][number]['class'],
        status: e.status,
        unitName: e.unit.name,
        at: (e.arrivedAt ?? e.createdAt).toISOString(),
        primaryDiagnosis: primaryOf.get(e.id) ?? null,
      })),
      latestVitals: latestVital
        ? {
            encounterId: latestVital.encounterId,
            at: latestVital.occurredAt,
            values: latestVital.values,
            ews: { ...latestVital.ews, at: latestVital.occurredAt },
          }
        : null,
      recentResults,
      recentProcedures: await this.diagnosis.presentProcedures(procedures),
      activeMedications: meds
        .filter((m) => m.statusEvents[0]?.status === 'aktif')
        .map((m) => ({
          id: m.id,
          encounterId: m.encounterId,
          name: m.name,
          sig: `${m.dose} · ${m.route} · ${
            MEDICATION_FREQUENCIES[m.frequency as MedicationFrequency]?.label ?? m.frequency
          }`,
          highAlert: m.highAlert,
          orderedAt: m.createdAt.toISOString(),
        })),
    };
  }

  private async banner(patientId: string): Promise<PatientBanner> {
    const p = await this.db.tx().patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        name: true,
        mrn: true,
        sex: true,
        birthDate: true,
        unidentified: true,
        confidential: true,
      },
    });
    if (!p) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    return {
      id: p.id,
      name: p.name,
      mrn: p.mrn,
      sex: p.sex as PatientBanner['sex'],
      birthDate: p.birthDate ? isoFromDbDate(p.birthDate) : null,
      ageYears: ageYears(p.birthDate, isoDateJakarta()),
      unidentified: p.unidentified,
      confidential: p.confidential,
    };
  }
}

function ewsSummary(score: number, maxParam: number, at: Date) {
  return { score, maxParam, risk: ewsRisk(score, maxParam).level, at: at.toISOString() };
}

/** Label pendek alergi untuk banner (teks + kritikalitas), bukan hanya warna. */
export function allergyLabels(a: PatientAllergies): string[] {
  if (a.status === 'nkda') return ['Tidak ada alergi obat (NKDA)'];
  return a.allergies.map((x) => {
    const name = x.substance?.name ?? x.text ?? 'Alergen';
    return x.criticality ? `${name} · ${CRITICALITY[x.criticality] ?? x.criticality}` : name;
  });
}
