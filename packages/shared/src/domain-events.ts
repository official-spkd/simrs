import { z } from 'zod';
import { PAYER_KINDS, ENCOUNTER_CLASSES } from './schemas/registration';
import { type BpjsTaskId, QUEUE_SERVICE_KINDS } from './schemas/queue';

/**
 * Event domain internal (CLAUDE.md §5: `EventEmitter` di API; efek ke luar lewat outbox). Diterbitkan SETELAH
 * transaksi asal commit oleh publisher API (rencana fase 2 potongan 1b). Muatan hanya ID, waktu, dan kode yang
 * dibutuhkan pendengar: tanpa PHI (nama, NIK, diagnosis), sehingga aman dicatat dan diteruskan.
 * Pendengar utama fase 2: mesin task ID Antrean BPJS (potongan 4a) dan SSE display (ADR-0026).
 */

const isoDateTime = z.iso.datetime({ offset: true });
const base = { tenantId: z.uuid(), at: isoDateTime };

/** Tiket antrean pada transisi panggil/mulai/selesai. `serviceKind` menentukan task BPJS yang terbentuk. */
const ticketEvent = z.strictObject({
  ...base,
  ticketId: z.uuid(),
  serviceId: z.uuid(),
  serviceKind: z.enum(QUEUE_SERVICE_KINDS),
  appointmentId: z.uuid().nullable(),
  encounterId: z.uuid().nullable(),
});

export const DOMAIN_EVENT_SCHEMAS = {
  /** F02 · Booking di-check-in (anjungan/loket) → task 1. */
  'booking.checked_in': z.strictObject({ ...base, appointmentId: z.uuid() }),
  /** F02 · Booking dibatalkan → task 99 (dan `bpjs.antrean.batal` oleh modul booking). */
  'booking.cancelled': z.strictObject({ ...base, appointmentId: z.uuid() }),
  /** F04 · Tiket dipanggil (termasuk ulang: `recall`). Loket pendaftaran → task 2. */
  'queue.ticket_called': ticketEvent.extend({ callId: z.uuid(), recall: z.boolean() }),
  /** F04 · Layanan dimulai. Poli → task 4; farmasi → task 6 (fase 4). */
  'queue.ticket_started': ticketEvent,
  /** F04 · Layanan selesai. Poli → task 5; farmasi → task 7 (fase 4). */
  'queue.ticket_finished': ticketEvent,
  /** F03 · Kunjungan terdaftar → task 3 (rawat jalan dari booking). */
  'encounter.registered': z.strictObject({
    ...base,
    encounterId: z.uuid(),
    patientId: z.uuid(),
    class: z.enum(ENCOUNTER_CLASSES),
    unitId: z.uuid(),
    appointmentId: z.uuid().nullable(),
    payer: z.enum(PAYER_KINDS).nullable(),
  }),
  /** F06 · SEP terbit (nomor dari BPJS). */
  'sep.issued': z.strictObject({ ...base, sepId: z.uuid(), encounterId: z.uuid() }),
  /** F03 · Kunjungan dibatalkan → task 99 bila dari booking. */
  'encounter.cancelled': z.strictObject({
    ...base,
    encounterId: z.uuid(),
    appointmentId: z.uuid().nullable(),
  }),
} as const;

export type DomainEventName = keyof typeof DOMAIN_EVENT_SCHEMAS;
export const DOMAIN_EVENT_NAMES = Object.keys(DOMAIN_EVENT_SCHEMAS) as [
  DomainEventName,
  ...DomainEventName[],
];
export type DomainEventPayload<N extends DomainEventName> = z.infer<(typeof DOMAIN_EVENT_SCHEMAS)[N]>;
export type DomainEvent = {
  [N in DomainEventName]: { name: N; payload: DomainEventPayload<N> };
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
): { appointmentId: string; taskId: BpjsTaskId; at: string } | null {
  const task = (appointmentId: string | null, taskId: BpjsTaskId | null) =>
    appointmentId && taskId ? { appointmentId, taskId, at: event.payload.at } : null;
  switch (event.name) {
    case 'booking.checked_in':
      return task(event.payload.appointmentId, 1);
    case 'booking.cancelled':
      return task(event.payload.appointmentId, 99);
    case 'queue.ticket_called':
      return event.payload.recall
        ? null
        : task(event.payload.appointmentId, event.payload.serviceKind === 'admisi' ? 2 : null);
    case 'encounter.registered':
      return task(event.payload.appointmentId, event.payload.class === 'rawat_jalan' ? 3 : null);
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
