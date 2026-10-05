import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import { isUuid, newId } from '@simrs/shared';
import { requestContext } from '../../common/request-context';
import { DOMAIN_EVENT_NAMES, type DomainEventMap, type DomainEventName } from './domain-event-map';

export interface DomainEvent<K extends DomainEventName = DomainEventName> {
  /** UUID v7, unik per publikasi (bisa dipakai sebagai kunci idempotensi turunan, mis. outbox task ID). */
  id: string;
  name: K;
  tenantId: string;
  occurredAt: Date;
  actor: { userId: string | null; role: string | null };
  payload: Readonly<DomainEventMap[K]>;
}

/** Transaksi yang sama dengan penerbit: tulisan penangan ikut commit/batal bersama perubahan asalnya. */
export interface DomainEventContext {
  tx: TenantTx;
  tenantId: string;
}

export type DomainEventHandler<K extends DomainEventName> = (
  event: DomainEvent<K>,
  ctx: DomainEventContext,
) => Promise<void> | void;

interface Registration {
  label: string;
  handle: (event: DomainEvent, ctx: DomainEventContext) => Promise<void> | void;
}

/** Nilai enum di payload: token pendek huruf kecil (mis. `jkn`, `mobile_jkn`), bukan teks bebas. */
const ENUM_VALUE = /^[a-z0-9][a-z0-9_.-]{0,39}$/;

/**
 * Penjaga "tanpa PHI" payload event (disimpan di `domain_events`, ikut diekspor bersama jejak): kunci `…Id` berisi
 * UUID atau null, kunci `…Ids` berisi larik UUID, kunci lain hanya null/boolean/angka/token enum. Teks bebas (nama,
 * alamat, alasan) tidak bisa lolos. Pelanggaran = galat program.
 */
export function assertDomainEventPayload(name: string, payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    const ok = key.endsWith('Ids')
      ? Array.isArray(value) && value.every((v) => typeof v === 'string' && isUuid(v))
      : key.endsWith('Id')
        ? value === null || (typeof value === 'string' && isUuid(value))
        : value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && ENUM_VALUE.test(value));
    if (!ok) {
      throw new Error(`Payload event ${name}: kunci "${key}" harus ID (…Id/…Ids) atau nilai enum, tanpa PHI`);
    }
  }
}

/** Rantai event (penangan menerbitkan event lagi) lebih dalam dari ini dianggap siklus → galat program. */
export const MAX_DOMAIN_EVENT_DEPTH = 8;

/**
 * Event domain dalam proses (CLAUDE.md §5: "Event domain lewat EventEmitter internal"), SINKRON di dalam transaksi
 * penerbit: `publish()` menyimpan event ke `domain_events` lalu menunggu semua penangan secara berurutan (urutan
 * pendaftaran) dengan transaksi yang sama. Event tersimpan ikut commit/batal bersama perubahan asalnya.
 * Penangan yang gagal membatalkan seluruh permintaan, jadi reaksi (task ID BPJS, tiket antrean, outbox) selalu
 * konsisten dengan perubahan asalnya. Efek ke sistem luar tetap lewat outbox di dalam penangan.
 *
 * Pendaftaran oleh modul pemakai, biasanya di `onModuleInit`:
 * ```ts
 * this.events.on('booking.checked_in', (e, { tx }) => this.taskIds.record(tx, e.payload.appointmentId, 1),
 *   { label: 'queue.task-id' });
 * ```
 * Penerbit memanggil `await this.events.publish('booking.checked_in', { appointmentId, patientId })` dari service
 * di dalam transaksi permintaan, atau di dalam `TenantDb.transaction()` pada handler `@NoRequestTransaction()`.
 */
@Injectable()
export class DomainEvents {
  private readonly handlers = new Map<DomainEventName, Registration[]>();
  private readonly depth = new WeakMap<TenantTx, number>();

  /** Daftarkan penangan; kembalikan fungsi pelepas. */
  on<K extends DomainEventName>(
    name: K,
    handler: DomainEventHandler<K>,
    options: { label?: string } = {},
  ): () => void {
    if (!(DOMAIN_EVENT_NAMES as readonly string[]).includes(name)) {
      throw new Error(`Event domain tidak dikenal: ${name}`);
    }
    const registration: Registration = {
      label: options.label ?? (handler.name || 'anonim'),
      handle: handler as Registration['handle'],
    };
    const list = this.handlers.get(name) ?? [];
    this.handlers.set(name, [...list, registration]);
    return () => {
      const current = this.handlers.get(name) ?? [];
      this.handlers.set(
        name,
        current.filter((r) => r !== registration),
      );
    };
  }

  /** Label penangan terdaftar untuk satu event (diagnostik/tes). */
  handlerLabels(name: DomainEventName): string[] {
    return (this.handlers.get(name) ?? []).map((r) => r.label);
  }

  /**
   * Terbitkan event: simpan barisnya di `domain_events` (transaksi aktif) LALU jalankan semua penangannya. Di luar
   * transaksi → galat program (event tanpa transaksi bisa hilang atau setengah jadi). Hasil `id` = id baris tersimpan.
   */
  async publish<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): Promise<DomainEvent<K>> {
    const ctx = requestContext.getStore();
    if (!ctx?.tx) {
      throw new Error(
        'DomainEvents.publish() di luar transaksi. Panggil dari service dalam permintaan @TenantScoped() atau TenantDb.transaction().',
      );
    }
    const { tx, tenantId } = ctx;
    const level = (this.depth.get(tx) ?? 0) + 1;
    if (level > MAX_DOMAIN_EVENT_DEPTH) {
      throw new Error(
        `Rantai event domain melebihi ${MAX_DOMAIN_EVENT_DEPTH} tingkat (kemungkinan siklus): ${name}`,
      );
    }
    assertDomainEventPayload(name, payload as Record<string, unknown>);
    const event: DomainEvent<K> = {
      id: newId(),
      name,
      tenantId,
      occurredAt: new Date(),
      actor: { userId: ctx.actor.userId, role: ctx.actor.role },
      payload: Object.freeze({ ...payload }),
    };
    await tx.domainEvent.create({
      data: {
        id: event.id,
        tenantId,
        name,
        payload: { ...payload },
        occurredAt: event.occurredAt,
        requestId: ctx.requestId,
        actorUserId: ctx.actor.userId,
        actorDeviceId: ctx.actor.deviceId ?? null,
      },
    });
    this.depth.set(tx, level);
    try {
      // Salinan daftar: pendaftaran/pelepasan selama publikasi tidak mengubah putaran ini.
      for (const registration of [...(this.handlers.get(name) ?? [])]) {
        await registration.handle(event as DomainEvent, { tx, tenantId });
      }
    } finally {
      if (level === 1) this.depth.delete(tx);
      else this.depth.set(tx, level - 1);
    }
    return event;
  }
}
