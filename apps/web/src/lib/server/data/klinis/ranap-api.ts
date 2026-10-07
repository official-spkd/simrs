import 'server-only';
import {
  type ActiveWristbandScan,
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
 * Titik sambung potongan 3.8 (konsultasi/rawat bersama, paket formulir + kelengkapan, dokumen pasien). Diisi setelah
 * modul 3.8 tergabung di master; sampai itu `null` dan tab "Dokumen & konsultasi" tidak tampil (tidak ada tombol mati).
 */
export interface InpatientExtensions {
  /** Permintaan/jawaban konsultasi dan tim rawat bersama (K10). */
  consults: null;
  /** Kelengkapan paket formulir rawat inap (K15, EP 6b/7a). */
  completeness: null;
  /** Dokumen pasien + status TTE (utang P08). */
  documents: null;
}

async function loadExtensions(_encounterId: string): Promise<InpatientExtensions> {
  return { consults: null, completeness: null, documents: null };
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

/** Bacaan pelengkap: 403/404 (izin/modul RS mati) = tidak ditampilkan, bukan galat halaman. */
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
    throw err;
  }
}

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
    loadExtensions(encounterId),
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
