import type { InboundEvent, TenantTx } from '@simrs/db';
import type { DomainEventName, DomainEventPayload, InboundSource } from '@simrs/shared';

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
   * Catatan: penangan event dalam proses milik API TIDAK berjalan di worker; reaksi lintas modul yang wajib langsung
   * (mis. notifikasi) ditulis penangan sendiri di transaksi ini (outbox/notifikasi).
   */
  recordEvent<N extends DomainEventName>(name: N, payload: DomainEventPayload<N>): Promise<string>;
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
>([]);
