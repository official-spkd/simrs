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
/** Jeda backoff eksponensial: 2 dtk × 2^(n−1), maks. 5 menit (pola outbox ADR-0003). */
export const INBOUND_RETRY_BASE_MS = 2_000;
export const INBOUND_RETRY_CAP_MS = 5 * 60_000;
/** Masa sewa klaim `processing`: worker yang mati di tengah jalan melepas pesan setelah ini. */
export const INBOUND_LEASE_MS = 60_000;
/** Teks galat yang disimpan (tanpa PHI; potongan pesan galat). */
export const INBOUND_ERROR_MAX = 500;

/** S01 · Ingest analyzer: batas ukuran body dan tipe konten yang diterima. */
export const LIS_INGEST_PATH = '/api/v1/devices/lis/hl7';
export const LIS_ENROL_PATH = '/api/v1/devices/lis/enrol';
export const LIS_HL7_CONTENT_TYPES = [
  'application/hl7-v2',
  'x-application/hl7-v2+er7',
  'text/plain',
] as const;

/** Charset body HL7 yang diterima (parameter `charset` Content-Type; tanpa parameter = UTF-8). Lainnya → 415. */
export const LIS_HL7_CHARSETS = {
  'utf-8': 'utf8',
  utf8: 'utf8',
  'iso-8859-1': 'latin1',
  latin1: 'latin1',
} as const;

/** Encoding Node untuk Content-Type HL7, atau null bila charset tidak didukung. */
export function lisHl7Encoding(contentType: string | undefined): 'utf8' | 'latin1' | null {
  const param = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  if (param === undefined) return 'utf8';
  return (LIS_HL7_CHARSETS as Record<string, 'utf8' | 'latin1'>)[param] ?? null;
}

export function isInboundSource(source: string): source is InboundSource {
  return Object.hasOwn(INBOUND_SOURCES, source);
}
