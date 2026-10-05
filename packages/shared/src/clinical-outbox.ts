import { z } from 'zod';
import type { IntegrationTarget } from './outbox';

/**
 * K01–K15 · Operasi outbox klinis (fase 3, rencana §3.0a; ADR-0003, ADR-0017). Payload HANYA ID baris domain; worker
 * membaca data terbaru saat `prepare`, sehingga PHI tidak tersimpan di `outbox_messages`.
 *
 * - `bpjs.aplicare.update`: ketersediaan bed per kelas ruang ke Aplicare BPJS (K05). Digabung per ruang: satu pesan per
 *   perubahan papan bed membawa `unitId` + `revision`; pesan dengan revisi lebih lama dilewati worker (pola HFIS).
 * - `satusehat.<resource>.upsert`: staging SATUSEHAT (ADR-0032). Dicatat sekarang berstatus `held` (tidak diklaim
 *   dispatcher), dilepas berurutan fase 7, Encounter dulu (keputusan fase 3 no. 13).
 *
 * Idempotency key: `<operasi>:<id>[:<revisi>]` (`clinicalOutboxKey`).
 */

const id = z.uuid();

/** Resource FHIR yang distaging fase 3 (docs/04 §4). */
export const SATUSEHAT_RESOURCES = [
  'Encounter',
  'Condition',
  'Observation',
  'Procedure',
  'AllergyIntolerance',
  'ServiceRequest',
  'MedicationRequest',
  'MedicationAdministration',
  'DiagnosticReport',
  'Composition',
] as const;
export type SatusehatResource = (typeof SATUSEHAT_RESOURCES)[number];

/** Nama operasi SATUSEHAT: `satusehat.encounter.upsert`, `satusehat.allergyintolerance.upsert`, …. */
export type SatusehatUpsertOperation = `satusehat.${Lowercase<SatusehatResource>}.upsert`;

export function satusehatUpsertOperation(resource: SatusehatResource): SatusehatUpsertOperation {
  return `satusehat.${resource.toLowerCase()}.upsert` as SatusehatUpsertOperation;
}

/** Payload staging SATUSEHAT: ID baris sumber + revisi (versi entri klinis; pesan revisi lama dilewati). */
const satusehatPayload = z.strictObject({ sourceId: id, revision: z.int().min(1) });

function satusehatOperations(): Record<
  SatusehatUpsertOperation,
  { target: 'satusehat'; label: string; resource: SatusehatResource; payload: typeof satusehatPayload }
> {
  return Object.fromEntries(
    SATUSEHAT_RESOURCES.map((resource) => [
      satusehatUpsertOperation(resource),
      { target: 'satusehat', label: `Kirim ${resource} ke SATUSEHAT`, resource, payload: satusehatPayload },
    ]),
  ) as Record<
    SatusehatUpsertOperation,
    { target: 'satusehat'; label: string; resource: SatusehatResource; payload: typeof satusehatPayload }
  >;
}

export const CLINICAL_OPERATIONS = {
  /** K05 · Perbarui ketersediaan bed ruang (kelas Aplicare dari `locations.care_class`) setelah status bed berubah. */
  'bpjs.aplicare.update': {
    target: 'bpjs',
    label: 'Perbarui ketersediaan bed Aplicare',
    payload: z.strictObject({ unitId: id, revision: z.int().min(1) }),
  },
  ...satusehatOperations(),
} as const satisfies Record<
  string,
  { target: IntegrationTarget; label: string; payload: z.ZodType<Record<string, unknown>> }
>;

export type ClinicalOperation = keyof typeof CLINICAL_OPERATIONS;
export type ClinicalOperationPayload<O extends ClinicalOperation> = z.infer<
  (typeof CLINICAL_OPERATIONS)[O]['payload']
>;

export const BPJS_APLICARE_UPDATE_OPERATION = 'bpjs.aplicare.update' satisfies ClinicalOperation;

export function isClinicalOperation(name: string): name is ClinicalOperation {
  return Object.hasOwn(CLINICAL_OPERATIONS, name);
}

/** Validasi payload operasi klinis. Melempar ZodError bila salah. */
export function parseClinicalOperationPayload<O extends ClinicalOperation>(
  operation: O,
  payload: unknown,
): ClinicalOperationPayload<O> {
  return CLINICAL_OPERATIONS[operation].payload.parse(payload) as ClinicalOperationPayload<O>;
}

/** Idempotency key deterministik `<operasi>:<id>[:<revisi>]`. */
export function clinicalOutboxKey(operation: ClinicalOperation, rowId: string, revision?: number): string {
  return revision === undefined ? `${operation}:${rowId}` : `${operation}:${rowId}:${revision}`;
}
