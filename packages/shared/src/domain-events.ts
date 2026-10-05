import { z } from 'zod';
import { PAYER_KINDS, ENCOUNTER_CLASSES } from './schemas/registration';
import type { AntreanTaskId } from './integrations/bpjs/antrean';
import { QUEUE_SERVICE_KINDS } from './schemas/queue';

/**
 * Event domain internal (CLAUDE.md §5) fase 2: nama + skema MUATAN. Amplop (`id`, `tenantId`, `occurredAt`, `actor`)
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
    class: z.enum(ENCOUNTER_CLASSES),
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
      return task(event.payload.appointmentId, event.payload.class === 'AMB' ? 3 : null);
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
      return null;
  }
}
