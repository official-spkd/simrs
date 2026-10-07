import 'server-only';
import {
  type ActiveWristbandScan,
  type CareTeamMember,
  type ConsultRequestRecord,
  type EncounterCompleteness,
  type PatientDocumentView,
  CONSENT_DECISIONS,
  activeWristbandScanSchema,
  type ConditionRecord,
  conditionRecordSchema,
  type CpptRecord,
  cpptRecordSchema,
  type DoubleCheckView,
  doubleCheckViewSchema,
  type EmarBoard,
  emarBoardSchema,
  type EncounterContext,
  encounterContextSchema,
  type FluidBalanceDay,
  fluidBalanceDaySchema,
  type HandoverRecord,
  handoverRecordSchema,
  type InpatientCensus,
  inpatientCensusSchema,
  type NursingCarePlanRecord,
  nursingCarePlanRecordSchema,
  type NursingDiagnosisOption,
  nursingDiagnosisOptionSchema,
  type PatientResults,
  patientResultsSchema,
  type VitalSignsRecord,
  vitalSignsRecordSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { can, type SessionView } from '../../../session-view';
import { api } from '../../api';
import { ApiError } from '../../api-core';
import { patientDocuments } from './dokumen';
import { careTeam, completeness, encounterConsults, optional } from './konsul';

/**
 * K04/K07/K12 · Data layar Rawat inap mode api (fase 3 layar W4). Satu-satunya pintu layar ini ke API (Data Access
 * Layer): daftar pasien per unit/bed (`/inpatients`, ABAC + audit di API) dan rekam rawat inap satu kunjungan yang
 * dihimpun dari rute per kunjungan kanonik (banner, diagnosis, CPPT, serah terima, tanda vital/NEWS2, eMAR, askep,
 * balans cairan, hasil). Bacaan yang butuh izin lain (`medication.administer`, `result.read`) hanya diminta bila
 * sesi memegangnya, jadi peran tanpa izin itu tidak memicu 403. Mode presentasi tetap di `ranap.ts` (dibekukan).
 */

/** Daftar pasien rawat inap yang boleh dibuka pelaku (`unitId` = saringan unit, null = semua unit terlihat). */
export function getInpatientCensus(unitId: string | null): Promise<InpatientCensus> {
  const q = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  return api(`/api/v1/inpatients${q}`, { schema: inpatientCensusSchema });
}

/**
 * Bagian potongan 3.8 (ADR-0059) di tab "Dokumen & konsultasi": konsultasi + tim perawatan (K10), kelengkapan paket
 * formulir rawat inap (K15, EP 6b/7a), dan dokumen pasien + status TTE (utang P08). Tiap bagian null bila sesi tidak
 * memegang izinnya atau API menolak (403/404); tab tampil bila salah satu bagian ada.
 */
export interface InpatientExtensions {
  consults: {
    requests: ConsultRequestRecord[];
    team: CareTeamMember[];
  } | null;
  completeness: EncounterCompleteness | null;
  documents: PatientDocumentView[] | null;
}

async function loadExtensions(
  session: SessionView,
  encounterId: string,
  patientId: string,
): Promise<InpatientExtensions> {
  const read = can(session, 'clinical', 'read');
  const [requests, team, completenessView, documents] = await Promise.all([
    read ? optional(() => encounterConsults(encounterId)) : null,
    read ? optional(() => careTeam(encounterId)) : null,
    read ? optional(() => completeness(encounterId)) : null,
    can(session, 'documents', 'read') ? optional(() => patientDocuments(patientId)) : null,
  ]);
  return {
    consults: requests && team ? { requests, team } : null,
    completeness: completenessView,
    documents,
  };
}

/**
 * Status resume medis (3.6) dan persetujuan tindakan (3.7) pasien ini, untuk tautan + status di layar Rawat inap.
 * Layar Resume (W5b) dan tablet Persetujuan (W5a) milik layar masing-masing; di sini hanya ringkasannya.
 */
const dischargeStatusSchema = z.object({
  state: z.enum(['belum', 'draf', 'final']),
  final: z
    .object({
      recordedAt: z.iso.datetime({ offset: true }),
      document: z.object({ signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable() }).nullable(),
    })
    .nullable(),
});
export type DischargeStatus = z.infer<typeof dischargeStatusSchema>;

const consentStatusSchema = z.object({
  id: z.uuid(),
  procedure: z.string(),
  effectiveDecision: z.enum(CONSENT_DECISIONS),
  occurredAt: z.iso.datetime({ offset: true }),
  document: z.object({ signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable() }).nullable(),
});
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export interface InpatientRecordView {
  context: EncounterContext;
  conditions: ConditionRecord[];
  cppt: CpptRecord[];
  handovers: HandoverRecord[];
  /** Tanda vital terbaru dulu (jawaban API). */
  vitals: VitalSignsRecord[];
  emar: EmarBoard;
  /** Pindaian gelang aktif + atestasi cek ganda; null bila sesi tanpa `medication.administer`. */
  scans: ActiveWristbandScan[] | null;
  doubleChecks: DoubleCheckView[] | null;
  carePlans: NursingCarePlanRecord[];
  nursingDiagnoses: NursingDiagnosisOption[];
  fluids: FluidBalanceDay;
  /** Null bila sesi tanpa `result.read`. */
  results: PatientResults | null;
  /** Null bila izin/modul tidak ada. */
  discharge: DischargeStatus | null;
  consents: ConsentStatus[] | null;
  extensions: InpatientExtensions;
}

export type InpatientRecordResult =
  { kind: 'ok'; record: InpatientRecordView } | { kind: 'not-found' } | { kind: 'denied'; message: string };

const enc = (id: string) => `/api/v1/encounters/${id}`;

/** Rekam rawat inap satu kunjungan; 404/403 dari banner menentukan keadaan halaman (bukan galat). */
export async function getInpatientRecord(
  session: SessionView,
  encounterId: string,
): Promise<InpatientRecordResult> {
  if (!z.uuid().safeParse(encounterId).success) return { kind: 'not-found' };
  let context: EncounterContext;
  try {
    context = await api(`${enc(encounterId)}/context`, { schema: encounterContextSchema });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return { kind: 'not-found' };
    if (err instanceof ApiError && err.status === 403) return { kind: 'denied', message: err.message };
    throw err;
  }
  const administer = can(session, 'medication', 'administer');
  const [
    conditions,
    cppt,
    handovers,
    vitals,
    emar,
    scans,
    doubleChecks,
    carePlans,
    nursingDiagnoses,
    fluids,
    results,
    discharge,
    consents,
    extensions,
  ] = await Promise.all([
    api(`${enc(encounterId)}/conditions`, { schema: conditionRecordSchema.array() }),
    api(`${enc(encounterId)}/cppt`, { schema: cpptRecordSchema.array() }),
    api(`${enc(encounterId)}/handovers`, { schema: handoverRecordSchema.array() }),
    api(`${enc(encounterId)}/observations`, { schema: vitalSignsRecordSchema.array() }),
    api(`${enc(encounterId)}/emar`, { schema: emarBoardSchema }),
    administer
      ? api(`/api/v1/nursing/wristband-scans?encounterId=${encounterId}`, {
          schema: activeWristbandScanSchema.array(),
        })
      : null,
    administer
      ? api(`/api/v1/nursing/double-checks?encounterId=${encounterId}`, {
          schema: doubleCheckViewSchema.array(),
        })
      : null,
    api(`${enc(encounterId)}/care-plans`, { schema: nursingCarePlanRecordSchema.array() }),
    api('/api/v1/nursing/diagnoses', { schema: nursingDiagnosisOptionSchema.array() }),
    api(`${enc(encounterId)}/fluid-balances`, { schema: fluidBalanceDaySchema }),
    can(session, 'result', 'read')
      ? api(`/api/v1/results?patientId=${context.patient.id}&encounterId=${encounterId}&limit=50`, {
          schema: patientResultsSchema,
        })
      : null,
    optional(() => api(`${enc(encounterId)}/discharge-summary`, { schema: dischargeStatusSchema })),
    can(session, 'consent', 'read')
      ? optional(() => api(`${enc(encounterId)}/consents`, { schema: consentStatusSchema.array() }))
      : null,
    loadExtensions(session, encounterId, context.patient.id),
  ]);
  return {
    kind: 'ok',
    record: {
      context,
      conditions,
      cppt,
      handovers,
      vitals,
      emar,
      scans,
      doubleChecks,
      carePlans,
      nursingDiagnoses,
      fluids,
      results,
      discharge,
      consents,
      extensions,
    },
  };
}
