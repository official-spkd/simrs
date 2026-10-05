import { Injectable } from '@nestjs/common';
import { AppError, type BedStatus, clinicalError, newId } from '@simrs/shared';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { bedConflict } from './adt-helpers';
import { AplicareSyncService } from './aplicare-sync.service';

export interface BedRow {
  id: string;
  locationId: string;
  unitId: string;
  status: string;
  version: number;
  encounterId: string | null;
}

/**
 * K04/K05 · Operasi bed bersama ADT dan IGD: status bed berversi (versi + 1 dijaga trigger; tidak cocok →
 * `BED_VERSION_CONFLICT`), penempatan bed (EXCLUDE btree_gist → `BED_NOT_AVAILABLE`), event `bed.status_changed`, dan
 * Aplicare. Semua di transaksi permintaan.
 */
@Injectable()
export class BedOpsService {
  constructor(
    private readonly db: TenantDb,
    private readonly events: DomainEvents,
    private readonly aplicare: AplicareSyncService,
  ) {}

  async bedByLocation(locationId: string): Promise<BedRow> {
    const row = await this.db.tx().bedStatus.findUnique({
      where: { tenantId_locationId: { tenantId: this.db.tenantId(), locationId } },
    });
    if (!row) throw new AppError('NOT_FOUND', 'Tempat tidur tidak ditemukan', 404);
    return row;
  }

  /**
   * Ubah status bed dari versi yang diketahui (`baseVersion`). Versi lain → 409 `BED_VERSION_CONFLICT` tanpa menimpa.
   */
  async setStatus(
    bed: BedRow,
    to: BedStatus,
    opts: { encounterId: string | null; note?: string | null; baseVersion?: number },
  ): Promise<BedRow> {
    const base = opts.baseVersion ?? bed.version;
    const { count } = await this.db.tx().bedStatus.updateMany({
      where: { id: bed.id, version: base },
      data: {
        status: to,
        version: base + 1,
        encounterId: opts.encounterId,
        note: opts.note ?? null,
        changedBy: this.db.actorUserId(),
      },
    });
    if (count === 0) throw clinicalError('BED_VERSION_CONFLICT');
    await this.events.publish('bed.status_changed', {
      bedId: bed.locationId,
      unitId: bed.unitId,
      fromStatus: bed.status as BedStatus,
      toStatus: to,
      version: base + 1,
    });
    await this.aplicare.touch(bed.locationId);
    return { ...bed, status: to, version: base + 1, encounterId: opts.encounterId };
  }

  /** Penempatan baru (periode terbuka). Hunian ganda ditolak database. */
  async assign(encounterId: string, patientId: string, locationId: string, at: Date): Promise<string> {
    const id = newId();
    try {
      await this.db.tx().bedAssignment.create({
        data: {
          id,
          tenantId: this.db.tenantId(),
          encounterId,
          patientId,
          locationId,
          startedAt: at,
          createdBy: this.db.actorUserId(),
        },
      });
    } catch (err) {
      throw bedConflict(err) ?? err;
    }
    return id;
  }

  /** Tutup penempatan terbuka kunjungan (sekali); kembalikan lokasi yang ditinggalkan, atau null. */
  async endOpenAssignment(
    encounterId: string,
    reason: 'transfer' | 'pulang' | 'batal',
    at: Date,
  ): Promise<string | null> {
    const tx = this.db.tx();
    const open = await tx.bedAssignment.findFirst({ where: { encounterId, endedAt: null } });
    if (!open) return null;
    await tx.bedAssignment.update({
      where: { id: open.id },
      data: { endedAt: at, endReason: reason, endedBy: this.db.actorUserId() },
    });
    return open.locationId;
  }

  /** Bed yang ditinggalkan pasien (pulang/transfer) menjadi `kotor`. */
  async vacate(locationId: string): Promise<void> {
    const bed = await this.bedByLocation(locationId);
    if (bed.status === 'kotor') return;
    await this.setStatus(bed, 'kotor', { encounterId: null });
  }
}
