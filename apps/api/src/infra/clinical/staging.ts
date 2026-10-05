import { Injectable } from '@nestjs/common';
import { enqueueOutbox } from '@simrs/db';
import {
  CLINICAL_OPERATIONS,
  clinicalOutboxKey,
  newId,
  type SatusehatResource,
  satusehatUpsertOperation,
} from '@simrs/shared';
import { TenantDb } from '../tenant-db';

/**
 * ADR-0032 · Staging SATUSEHAT: setiap entri klinis yang kelak dikirim dicatat SEKARANG sebagai pesan outbox berstatus
 * `held` (tidak diklaim dispatcher) di transaksi yang sama dengan entrinya. Payload hanya ID baris sumber + revisi
 * (versi entri), tanpa PHI. Fase 7 melepas pesan `held` berurutan (Encounter dulu). Idempoten per sumber × revisi.
 */
@Injectable()
export class SatusehatRecorder {
  constructor(private readonly db: TenantDb) {}

  async record(resource: SatusehatResource, sourceId: string, revision = 1): Promise<void> {
    const operation = satusehatUpsertOperation(resource);
    const def = CLINICAL_OPERATIONS[operation];
    const payload = def.payload.parse({ sourceId, revision });
    await enqueueOutbox(
      this.db.tx(),
      this.db.tenantId(),
      {
        target: def.target,
        operation,
        idempotencyKey: clinicalOutboxKey(operation, sourceId, revision),
        payload,
      },
      { held: true },
    );
  }
}

/** Jenis peristiwa biaya (CHECK `billable_events_values_valid`). */
export const BILLABLE_KINDS = [
  'visite',
  'admisi',
  'transfer',
  'pulang',
  'igd',
  'lab',
  'radiologi',
  'tindakan',
  'obat',
  'konsultasi',
] as const;
export type BillableKind = (typeof BILLABLE_KINDS)[number];

/**
 * ADR-0032 · Staging biaya: peristiwa yang kelak ditagih dicatat TANPA harga (fase 5 memberi harga) di transaksi yang
 * sama. Idempoten: unik per (sumber, id, jenis); pencatatan ulang diabaikan.
 */
@Injectable()
export class BillableRecorder {
  constructor(private readonly db: TenantDb) {}

  async record(e: {
    encounterId: string;
    patientId: string;
    sourceType: string;
    sourceId: string;
    kind: BillableKind;
    quantity?: number;
    occurredAt: Date;
  }): Promise<void> {
    await this.db.tx().billableEvent.createMany({
      data: [
        {
          id: newId(),
          tenantId: this.db.tenantId(),
          encounterId: e.encounterId,
          patientId: e.patientId,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          kind: e.kind,
          quantity: e.quantity ?? 1,
          occurredAt: e.occurredAt,
          createdBy: this.db.actorUserId(),
        },
      ],
      skipDuplicates: true,
    });
  }
}
