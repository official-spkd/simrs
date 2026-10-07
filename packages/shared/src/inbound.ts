/**
 * Pemroses pesan MASUK generik (rencana fase 4 §4.0a/§4.1a; dipakai ulang webhook TPDI fase 6). Pesan mentah disimpan
 * dulu di `inbound_events` (dedup per sumber × idempotency key), dijawab 2xx/ACK secepatnya, lalu diproses async oleh
 * worker dengan retry eksponensial (`backoffDelayMs`) sampai DLQ. Tidak lewat outbox: arah data masuk.
 *
 * Fase 4 tidak menambah operasi outbox baru: SATUSEHAT untuk data penunjang dikirim fase 7 dari `domain_events`
 * (keputusan fase 4 no. 16), notifikasi memakai operasi P09 yang ada, task 6/7 memakai mesin task fase 2.
 */

/** Siklus `inbound_events.status`. `failed` = akan dicoba lagi; `dead` = berhenti, tampil di layar (bukan diam). */
export const INBOUND_STATUSES = ['received', 'processing', 'processed', 'failed', 'dead'] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

/** Sumber pesan masuk dan idempotency key-nya. */
export const INBOUND_SOURCES = {
  /** S01 · Hasil analyzer HL7 ORU^R01 (`POST /api/v1/devices/lis/hl7`); key = MSH-10; PID/NK1 diredaksi. */
  'lis-hl7': { label: 'Hasil analyzer laboratorium (HL7)', keyFrom: 'MSH-10' },
} as const;
export type InboundSource = keyof typeof INBOUND_SOURCES;

/** Maks percobaan proses sebelum `dead`. */
export const INBOUND_MAX_ATTEMPTS = 8;

export function isInboundSource(source: string): source is InboundSource {
  return Object.hasOwn(INBOUND_SOURCES, source);
}
