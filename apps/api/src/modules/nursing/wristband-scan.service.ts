import { Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  AppError,
  clinicalError,
  newId,
  type WristbandScanInput,
  type WristbandScanResult,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

const ACTIVE_ENCOUNTER = ['arrived', 'in_progress'];
/** Penanda `scanned_code` untuk verifikasi dua identitas (bukan kode gelang). */
const TWO_ID_MARKER = 'DUA-IDENTITAS';

/** Nama untuk dicocokkan: tanpa sapaan, huruf kecil, hanya huruf/angka/spasi tunggal. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(tn|ny|nn|an|by|sdr|sdri|bpk|ibu)\.?\s+/, '')
    .replace(/[^0-9a-z]+/g, ' ')
    .trim();
}

/**
 * K12 · Pindai gelang sebelum pemberian obat (keputusan fase 3 no. 8). Setiap pindaian tercatat (cocok atau tidak,
 * waktu dari server) di transaksi pendek yang di-commit lebih dulu; tidak cocok lalu dijawab 422 `WRISTBAND_MISMATCH`.
 * Gelang rusak/tidak terbaca: verifikasi dua identitas (nama lengkap + tanggal lahir atau No. RM) dicocokkan SERVER
 * dengan pasien kunjungan, beralasan, tercatat sebagai metode `dua_identitas`; masa berlaku sama dengan pindai biasa.
 */
@Injectable()
export class WristbandScanService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
  ) {}

  async scan(input: WristbandScanInput): Promise<WristbandScanResult> {
    const outcome = await this.db.transaction(() => this.record(input));
    // Pindaian tidak cocok sudah tercatat (commit); baru kemudian ditolak.
    if (!outcome.result) throw clinicalError('WRISTBAND_MISMATCH');
    return outcome.result;
  }

  private async record(input: WristbandScanInput): Promise<{ result: WristbandScanResult | null }> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({
      where: { id: input.encounterId },
      select: { id: true, patientId: true, status: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    await this.access.assert(enc.patientId);
    if (!ACTIVE_ENCOUNTER.includes(enc.status)) {
      throw new AppError('CONFLICT', 'Kunjungan tidak aktif; gelang tidak bisa dipindai', 409);
    }
    const userId = this.db.actorUserId();
    if (!userId) throw new AppError('FORBIDDEN', 'Pindai gelang butuh sesi pengguna', 403);
    const band = await tx.patientWristband.findFirst({
      where: { encounterId: enc.id, voidedAt: null },
      select: { id: true, code: true },
    });

    let matched: boolean;
    let scannedCode: string;
    let method: 'scan' | 'dua_identitas';
    let overrideReason: string | null = null;
    if ('code' in input) {
      method = 'scan';
      scannedCode = input.code.trim().toUpperCase();
      matched = band !== null && band.code === scannedCode;
    } else {
      method = 'dua_identitas';
      scannedCode = TWO_ID_MARKER;
      overrideReason = input.reason;
      const p = await tx.patient.findUniqueOrThrow({
        where: { id: enc.patientId },
        select: { name: true, birthDate: true, mrn: true, unidentified: true },
      });
      const second = input.secondIdentifier;
      const secondOk =
        second.kind === 'rm'
          ? p.mrn !== null && second.value.trim().toUpperCase() === p.mrn.toUpperCase()
          : !p.unidentified && p.birthDate !== null && p.birthDate.toISOString().slice(0, 10) === second.value;
      matched = band !== null && secondOk && normalizeName(input.name) === normalizeName(p.name);
    }

    const id = newId();
    await tx.wristbandScan.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        encounterId: enc.id,
        patientId: enc.patientId,
        wristbandId: matched && band ? band.id : null,
        matched,
        scannedCode,
        method,
        overrideReason,
        userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'wristband_scan',
      resourceId: id,
      patientId: enc.patientId,
      reason: overrideReason,
      details: { matched, method },
    });
    if (!matched) return { result: null };
    const row = await tx.wristbandScan.findUniqueOrThrow({ where: { id }, select: { scannedAt: true } });
    const validMinutes = await readTenantSetting(tx, 'emar.scan_valid_minutes');
    return {
      result: {
        scanId: id,
        encounterId: enc.id,
        method,
        scannedAt: row.scannedAt.toISOString(),
        validUntil: new Date(row.scannedAt.getTime() + validMinutes * 60_000).toISOString(),
      },
    };
  }
}
