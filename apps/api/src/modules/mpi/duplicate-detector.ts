import { Injectable, Logger } from '@nestjs/common';
import { detectDuplicates } from '@simrs/db';
import type { PatientCrypto } from '@simrs/shared/node';
import { TenantDb } from '../../infra/tenant-db';

/**
 * P05 · Hitung ulang kandidat rekam medis ganda di transaksi permintaan (setelah daftar, ubah identitas,
 * gabung, batal gabung). Data yang tidak bisa didekripsi tidak menggagalkan permintaan, tetapi dicatat sebagai
 * peringatan berisi ID internal saja (indikasi kunci salah atau data rusak; tanpa PHI).
 */
@Injectable()
export class DuplicateDetector {
  private readonly logger = new Logger('MPI');

  constructor(private readonly db: TenantDb) {}

  async run(crypto: PatientCrypto, patientId: string): Promise<void> {
    const result = await detectDuplicates(this.db.tx(), crypto, patientId);
    if (result.unreadable.length > 0) {
      this.logger.warn(
        `Deteksi duplikat: ${result.unreadable.length} rekam medis tidak bisa didekripsi (tenant ${this.db.tenantId()}): ${result.unreadable.join(', ')}`,
      );
    }
  }
}
