import { z } from 'zod';
import { ENCOUNTER_CLASSES, type EncounterClass, PAYER_KINDS } from './schemas/registration';
import type { AntreanTaskId } from './integrations/bpjs/antrean';
import { QUEUE_SERVICE_KINDS } from './schemas/queue';
import { MEDICATION_ADMINISTRATION_STATUSES } from './clinical/emar';
import { BED_STATUSES, DISCHARGE_DISPOSITIONS } from './schemas/rawat-inap';

/**
 * Event domain internal (CLAUDE.md §5) fase 2–3: nama + skema MUATAN. Amplop (`id`, `tenantId`, `occurredAt`, `actor`)
 * milik publisher API (`apps/api/src/infra/events`, potongan 1b) yang menjalankan penangan secara sinkron di transaksi
 * penerbit. Muatan hanya ID dan kode yang dibutuhkan pendengar, tanpa PHI (nama, NIK, diagnosis).
 * Pendengar utama fase 2: mesin task ID Antrean BPJS (potongan 4a, `bpjsTaskForEvent`).
 */

/** Tiket antrean pada transisi panggil/mulai/selesai. `serviceKind` menentukan task BPJS yang terbentuk. */
const ticketEvent = z.strictObject({
  ticketId: z.uuid(),
  queueServiceId: z.uuid(),
  serviceKind: z.enum(QUEUE_SERVICE_KINDS),
  appointmentId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
});

/**
 * Muatan event datar karena tersimpan di `domain_events` (migrasi 0b susulan): kunci `…Id` = UUID, `…Ids` = larik
 * UUID, selain itu hanya null, boolean, angka, atau token enum huruf kecil (tanpa teks bebas/PHI).
 */
export const ENCOUNTER_CLASS_TOKENS = ['amb', 'emer', 'imp'] as const;
export type EncounterClassToken = (typeof ENCOUNTER_CLASS_TOKENS)[number];
export function encounterClassToken(c: EncounterClass): EncounterClassToken {
  return c.toLowerCase() as EncounterClassToken;
}
/** Kebalikan `encounterClassToken`. */
export function encounterClassFromToken(t: EncounterClassToken): EncounterClass {
  return ENCOUNTER_CLASSES[ENCOUNTER_CLASS_TOKENS.indexOf(t)] as EncounterClass;
}

/** Muatan event klinis tingkat kunjungan. */
const clinicalEncounterEvent = z.strictObject({
  encounterId: z.uuid(),
  patientId: z.uuid(),
  encounterClass: z.enum(ENCOUNTER_CLASS_TOKENS),
  unitId: z.uuid(),
});

export const DOMAIN_EVENT_SCHEMAS = {
  /** F02 · Booking di-check-in (anjungan/loket) → task 1. */
  'booking.checked_in': z.strictObject({ appointmentId: z.uuid(), patientId: z.uuid() }),
  /** F02 · Booking dibatalkan → task 99 (dan `bpjs.antrean.batal` oleh modul booking). */
  'booking.cancelled': z.strictObject({ appointmentId: z.uuid(), patientId: z.uuid() }),
  /** F04 · Tiket dipanggil (termasuk ulang: `recall`). Loket pendaftaran (`loket`) → task 2. */
  'queue.ticket_called': ticketEvent.extend({ callId: z.uuid(), recall: z.boolean() }),
  /** F04 · Layanan dimulai. Poli → task 4; farmasi → task 6 (fase 4). */
  'queue.ticket_started': ticketEvent,
  /** F04 · Layanan selesai. Poli → task 5; farmasi → task 7 (fase 4). */
  'queue.ticket_finished': ticketEvent,
  /** F03 · Kunjungan terdaftar → task 3 (rawat jalan dari booking). */
  'encounter.registered': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    /** Kelas kunjungan sebagai token huruf kecil (`amb` | `emer` | `imp`; `encounters.class` huruf besar). */
    encounterClass: z.enum(ENCOUNTER_CLASS_TOKENS),
    unitId: z.uuid(),
    appointmentId: z.uuid().nullable(),
    payer: z.enum(PAYER_KINDS).nullable(),
  }),
  /** F06 · SEP terbit (nomor dari BPJS). */
  'sep.issued': z.strictObject({ sepId: z.uuid(), encounterId: z.uuid() }),
  /** F03 · Kunjungan dibatalkan → task 99 bila dari booking. */
  'encounter.cancelled': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    appointmentId: z.uuid().nullable(),
  }),
  // K01–K15 · Klinis RME (fase 3, rencana §3.0a). Pendengar: staging SATUSEHAT `held` dan `billable_events` (ADR-0032),
  // SSE papan IGD/bed, worklist. Tetap tanpa PHI: hanya ID dan token enum.
  /** K01/K02 · Pelayanan klinis kunjungan dimulai (dokter/perawat mulai memeriksa). */
  'encounter.started': clinicalEncounterEvent,
  /** K13 · Kunjungan selesai (gerbang tutup `DischargeGate` lolos). */
  'encounter.finished': clinicalEncounterEvent,
  /** K07 · CPPT final tersimpan (residen: `cosignRequired` → tugas co-sign DPJP). */
  'cppt.finalized': z.strictObject({
    cpptId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    cosignRequired: z.boolean(),
  }),
  /** K09 · Satu kiriman order aktif (lab/rad/tindakan → worklist penunjang fase 4; resep → farmasi). */
  'order.activated': z.strictObject({
    orderGroupId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    serviceRequestIds: z.array(z.uuid()),
    medicationRequestIds: z.array(z.uuid()),
    /** Order residen: tugas tinjau DPJP (keputusan fase 3 no. 4). */
    needsReview: z.boolean(),
  }),
  /** K09 · Satu order dibatalkan (beralasan). */
  'order.cancelled': z.strictObject({
    orderId: z.uuid(),
    orderType: z.enum(['service', 'medication']),
    encounterId: z.uuid(),
    patientId: z.uuid(),
  }),
  /** K12 · Pemberian obat tercatat (diberikan, ditunda, atau ditolak). */
  'medication.administered': z.strictObject({
    administrationId: z.uuid(),
    medicationRequestId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    status: z.enum(MEDICATION_ADMINISTRATION_STATUSES),
  }),
  /** K04 · Admisi rawat inap (bed terisi, gelang terbit). */
  'adt.admitted': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    unitId: z.uuid(),
    bedId: z.uuid(),
    /** Kunjungan IGD/RJ asal (`part_of`), null bila dari SPRI/elektif. */
    sourceEncounterId: z.uuid().nullable(),
  }),
  /** K04 · Pindah unit/bed (akses lingkup unit ikut pindah, ADR-0031). */
  'adt.transferred': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    fromUnitId: z.uuid(),
    toUnitId: z.uuid(),
    fromBedId: z.uuid().nullable(),
    toBedId: z.uuid(),
  }),
  /** K04 · Pasien pulang (bed → kotor). */
  'adt.discharged': z.strictObject({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    unitId: z.uuid(),
    bedId: z.uuid().nullable(),
    disposition: z.enum(DISCHARGE_DISPOSITIONS),
  }),
  /** K05 · Status bed berubah (papan bed SSE, Aplicare). */
  'bed.status_changed': z.strictObject({
    bedId: z.uuid(),
    unitId: z.uuid(),
    fromStatus: z.enum(BED_STATUSES),
    toStatus: z.enum(BED_STATUSES),
    version: z.int().min(1),
  }),
  /** K13 · Resume medis ditandatangani DPJP (TTE diminta; terkunci). */
  'discharge.signed': z.strictObject({
    dischargeSummaryId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
  }),
  /** K11 · Persetujuan atau penolakan tindakan final (TTE diminta). */
  'consent.signed': z.strictObject({
    consentId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    outcome: z.enum(['setuju', 'tolak']),
  }),
} as const;

export type DomainEventName = keyof typeof DOMAIN_EVENT_SCHEMAS;
export const DOMAIN_EVENT_NAMES = Object.keys(DOMAIN_EVENT_SCHEMAS) as [
  DomainEventName,
  ...DomainEventName[],
];
export type DomainEventPayload<N extends DomainEventName> = z.infer<(typeof DOMAIN_EVENT_SCHEMAS)[N]>;
/** Bagian amplop yang dibutuhkan pemetaan task ID (cocok dengan amplop publisher API). */
export type DomainEvent = {
  [N in DomainEventName]: { name: N; payload: DomainEventPayload<N>; occurredAt: Date | string };
}[DomainEventName];

export function isDomainEventName(name: string): name is DomainEventName {
  return Object.hasOwn(DOMAIN_EVENT_SCHEMAS, name);
}

/** Validasi muatan event (dipakai publisher sebelum menerbitkan dan pada tes). Melempar ZodError bila salah. */
export function parseDomainEvent<N extends DomainEventName>(
  name: N,
  payload: unknown,
): DomainEventPayload<N> {
  return DOMAIN_EVENT_SCHEMAS[name].parse(payload) as DomainEventPayload<N>;
}

/**
 * Task ID Antrean BPJS yang dibentuk sebuah event (docs/06 §2, rencana fase 2 potongan 4a), atau null.
 * Hanya kandidat: mesin task ID tetap menyaring booking JKN, menjaga urutan (task n menunggu n−1 lewat `defer`), dan
 * tidak pernah menimpa waktu task yang sudah tercatat. Panggilan ulang (`recall`) tidak membentuk task baru.
 */
export function bpjsTaskForEvent(
  event: DomainEvent,
): { appointmentId: string; taskId: AntreanTaskId; at: string } | null {
  const at = new Date(event.occurredAt).toISOString();
  const task = (appointmentId: string | null, taskId: AntreanTaskId | null) =>
    appointmentId && taskId ? { appointmentId, taskId, at } : null;
  switch (event.name) {
    case 'booking.checked_in':
      return task(event.payload.appointmentId, 1);
    case 'booking.cancelled':
      return task(event.payload.appointmentId, 99);
    case 'queue.ticket_called':
      return event.payload.recall
        ? null
        : task(event.payload.appointmentId, event.payload.serviceKind === 'loket' ? 2 : null);
    case 'encounter.registered':
      return task(event.payload.appointmentId, event.payload.encounterClass === 'amb' ? 3 : null);
    case 'queue.ticket_started':
      return task(
        event.payload.appointmentId,
        event.payload.serviceKind === 'poli' ? 4 : event.payload.serviceKind === 'farmasi' ? 6 : null,
      );
    case 'queue.ticket_finished':
      return task(
        event.payload.appointmentId,
        event.payload.serviceKind === 'poli' ? 5 : event.payload.serviceKind === 'farmasi' ? 7 : null,
      );
    case 'encounter.cancelled':
      return task(event.payload.appointmentId, 99);
    case 'sep.issued':
    case 'encounter.started':
    case 'encounter.finished':
    case 'cppt.finalized':
    case 'order.activated':
    case 'order.cancelled':
    case 'medication.administered':
    case 'adt.admitted':
    case 'adt.transferred':
    case 'adt.discharged':
    case 'bed.status_changed':
    case 'discharge.signed':
    case 'consent.signed':
      return null;
  }
}
