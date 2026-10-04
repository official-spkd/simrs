/**
 * Nama event domain fase 2 dan bentuk payload-nya. Payload hanya ID (tanpa PHI), sama seperti outbox (ADR-0017).
 *
 * SEMENTARA: nama disalin dari rencana potongan 0a (`docs/rencana/fase-2-front-office.md` §2). Setelah 0a tergabung,
 * ganti `DOMAIN_EVENT_NAMES` dengan impor dari `@simrs/shared` dan pertahankan `DomainEventMap` di sini (atau pindahkan
 * ke shared bila web/worker ikut memakainya). Bentuk payload boleh disesuaikan pemilik potongan domain (3, 4a, 5a).
 */
export const DOMAIN_EVENT_NAMES = [
  'booking.checked_in',
  'queue.ticket_called',
  'queue.ticket_started',
  'queue.ticket_finished',
  'encounter.registered',
  'sep.issued',
  'encounter.cancelled',
] as const;

export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

/** Payload per nama event. Event baru: tambah nama di atas dan entri di sini (typecheck menjaga keduanya sejalan). */
export interface DomainEventMap {
  /** F02 · Pasien booking hadir (loket atau anjungan). Memicu task ID 1. */
  'booking.checked_in': { appointmentId: string; patientId: string };
  /** F04 · Tiket dipanggil. Panggilan loket admisi memicu task ID 2. */
  'queue.ticket_called': { ticketId: string; queueServiceId: string; callId: string };
  /** F04 · Pelayanan tiket dimulai (poli: task ID 4). */
  'queue.ticket_started': { ticketId: string; queueServiceId: string };
  /** F04 · Pelayanan tiket selesai (poli: task ID 5). */
  'queue.ticket_finished': { ticketId: string; queueServiceId: string };
  /** F03 · Kunjungan terdaftar (task ID 3 bila dari booking). */
  'encounter.registered': { encounterId: string; patientId: string; appointmentId: string | null };
  /** F06 · SEP terbit (setelah respons BPJS diproses worker atau lookup). */
  'sep.issued': { sepId: string; encounterId: string };
  /** F03 · Kunjungan dibatalkan (task ID 99 bila dari booking). */
  'encounter.cancelled': { encounterId: string; patientId: string; appointmentId: string | null };
}

// Penjaga waktu kompilasi: setiap nama punya payload dan sebaliknya.
type MissingPayload = Exclude<DomainEventName, keyof DomainEventMap>;
type UnknownPayload = Exclude<keyof DomainEventMap, DomainEventName>;
export const DOMAIN_EVENT_MAP_COMPLETE: [MissingPayload, UnknownPayload] extends [never, never]
  ? true
  : never = true;
