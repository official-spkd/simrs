import type { InboundEvent, TenantTx } from '@simrs/db';
import type { DomainEventPayload, InboundSource, WorkerEmittedEvent } from '@simrs/shared';
import { lisHl7Handler } from './lis-hl7.handler';

/**
 * Konteks penangan pesan masuk. `tx` = transaksi tenant yang SAMA dengan penanda `processed` (ADR-0017): hasil
 * pemrosesan dan status pesan commit/batal bersama.
 */
export interface InboundHandlerContext {
  tenantId: string;
  tx: TenantTx;
  /** Saat putaran dimulai (pakai ini, bukan `new Date()`). */
  now: Date;
  /**
   * Simpan event domain ke `domain_events` (muatan divalidasi skema bersama, tanpa PHI; pelaku = perangkat pengirim).
   * Hanya `WORKER_EMITTED_EVENTS`: penangan in-process milik API TIDAK berjalan untuk event worker, jadi reaksi wajib
   * ditulis penangan sendiri di transaksi ini (outbox/notifikasi) atau lewat `pg_notify`/SSE tabel sumber.
   */
  recordEvent<N extends WorkerEmittedEvent>(name: N, payload: DomainEventPayload<N>): Promise<string>;
}

/** Penangan satu sumber (`inbound_events.source`). Lempar galat = gagal (dicoba lagi dengan backoff). */
export interface InboundHandler {
  handle(event: InboundEvent, ctx: InboundHandlerContext): Promise<void>;
}

/**
 * Galat permanen: isi tidak akan pernah bisa diproses (mis. format salah). Pesan langsung `dead` tanpa retry dan
 * tampil di layar pemilik sumber. `message` disimpan di `inbound_events.error`: wajib tanpa PHI.
 */
export class PermanentInboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentInboundError';
  }
}

/**
 * Galat sementara dengan pesan aman (tanpa PHI) untuk ditampilkan, mis. "barcode belum dikenal" (spesimen mungkin
 * belum diterima lab). Galat lain hanya dicatat nama kelasnya.
 */
export class RetryableInboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableInboundError';
  }
}

/** Token DI peta penangan (tes boleh menggantinya). */
export const INBOUND_HANDLER_REGISTRY = Symbol('INBOUND_HANDLER_REGISTRY');

/**
 * Peta penangan per sumber. Sumber tanpa penangan TIDAK diklaim (pesan tetap `received`, menunggu penangannya
 * dipasang). Satu baris per potongan:
 * - 4.2: `['lis-hl7', lisHl7Handler]` (cocokkan barcode OBR → hasil `preliminary` bersumber analyzer)
 * - fase 6: `['tpdi', …]` (webhook pembayaran)
 */
export const INBOUND_HANDLERS: ReadonlyMap<InboundSource, InboundHandler> = new Map<
  InboundSource,
  InboundHandler
>([
  // Fase 4 · 4.2: hasil analyzer lab (barcode OBR → hasil awal bersumber analyzer).
  ['lis-hl7', lisHl7Handler],
]);
