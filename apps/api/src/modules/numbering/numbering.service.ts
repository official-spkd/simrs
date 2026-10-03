import { Injectable } from '@nestjs/common';
import { type AllocatedNumber, allocateNumber } from '@simrs/db';
import type { NumberKind } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/**
 * P08 · Satu-satunya cara modul mendapatkan nomor dokumen (No. RM, kunjungan, invoice, jurnal).
 * Nomor dialokasikan di transaksi permintaan: bila permintaan gagal, nomor ikut batal.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly db: TenantDb) {}

  next(kind: NumberKind, at: Date = new Date()): Promise<AllocatedNumber> {
    return allocateNumber(this.db.tx(), this.db.tenantId(), kind, at);
  }
}
