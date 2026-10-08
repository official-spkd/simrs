import { Injectable } from '@nestjs/common';
import { raisedDbCode, uniqueViolationTarget } from '@simrs/db';
import { AppError, type SupportErrorCode, supportError } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

/** Kode `RAISE` trigger S06 (4.0b) → galat penunjang stabil. Pesan database tidak diteruskan. */
const RAISED: Readonly<Record<string, SupportErrorCode>> = {
  CHECKLIST_ORDER: 'CHECKLIST_ORDER',
  CHECKLIST_INCOMPLETE: 'CHECKLIST_INCOMPLETE',
  TIMEOUT_REQUIRED: 'TIMEOUT_REQUIRED',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  STOCK_INSUFFICIENT: 'STOCK_INSUFFICIENT',
  BATCH_EXPIRED: 'BATCH_EXPIRED',
};

/** Galat database kamar operasi (trigger, EXCLUDE, unik) → AppError; null bila tidak dikenal. */
export function surgeryDbError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  const raised = raisedDbCode(err);
  if (raised && RAISED[raised]) return supportError(RAISED[raised]);
  if (raised === 'VALIDATION_FAILED') {
    return new AppError('VALIDATION_FAILED', 'Isian tidak sesuai templat/aturan kamar operasi', 422);
  }
  if (raised === 'APPEND_ONLY')
    return new AppError('CONFLICT', 'Catatan kamar operasi tidak bisa diubah', 409);
  if (err instanceof Error) {
    const cause = (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } }).meta
      ?.driverAdapterError?.cause;
    const code = cause?.originalCode ?? (err as { code?: unknown }).code;
    if (code === '23P01' || /surgery_cases_no_room_overlap/.test(err.message))
      return supportError('ROOM_OVERLAP');
  }
  const target = uniqueViolationTarget(err);
  if (/surgical_safety_confirmations|phase/.test(target) && !/item/.test(target)) {
    return supportError('CHECKLIST_ORDER', undefined, 'Fase ini sudah dikonfirmasi');
  }
  if (/surgical_safety_checks|item_code/.test(target)) {
    return new AppError('CONFLICT', 'Butir ini sudah dicentang', 409);
  }
  if (/surgery_events|kind/.test(target))
    return new AppError('CONFLICT', 'Peristiwa ini sudah tercatat', 409);
  return null;
}

/** Jalankan `fn`; galat database S06 yang dikenal diubah menjadi galat API. */
export async function mapSurgeryDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw surgeryDbError(err) ?? err;
  }
}

export interface CaseRow {
  id: string;
  patientId: string;
  encounterId: string;
  roomId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Lingkup izin `surgery.*` (rencana fase 4 §4.0a): `unit` = perawat unit kamar operasi (kamar di unitnya);
 * `relationship` = dokter yang ada di tim operasi kasus itu atau berelasi dengan pasiennya (ABAC P03); `all` = bebas.
 * Anggota tim aktif selalu boleh membuka kasusnya (lingkup unit juga), sehingga penata anestesi di luar unit OK tetap
 * bisa menulis catatan anestesi kasus yang ditugaskan kepadanya (4.7c).
 */
@Injectable()
export class SurgeryAccess {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
  ) {}

  async okUnitId(): Promise<string> {
    const unit = await this.db.tx().unit.findFirst({
      where: { kind: 'kamar_operasi', active: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (!unit) throw new AppError('NOT_FOUND', 'Unit kamar operasi belum diatur', 404);
    return unit.id;
  }

  /** Lingkup unit: hanya penugasan di unit kamar operasi. */
  async assertUnit(): Promise<void> {
    if (this.db.permissionScope() !== 'unit') return;
    if (this.db.actor().unitId !== (await this.okUnitId())) {
      throw new AppError(
        'FORBIDDEN',
        'Kamar operasi hanya untuk petugas yang ditugaskan di unit kamar operasi',
        403,
      );
    }
  }

  /** Boleh membuka/menulis kasus ini (lingkup izin endpoint). */
  async assertCase(c: Pick<CaseRow, 'id' | 'patientId'>): Promise<void> {
    const scope = this.db.permissionScope();
    if (scope === 'all') return;
    // Anggota tim kasus (mis. penata anestesi dari unit lain, 4.7c) boleh membuka kasusnya sendiri.
    if (await this.inTeam(c.id)) return;
    if (scope === 'unit') return this.assertUnit();
    await this.access.assert(c.patientId);
  }

  /** Kasus terlihat di papan untuk pelaku ini (tanpa melempar). */
  async visible(c: Pick<CaseRow, 'id' | 'patientId'>, teamIds: ReadonlySet<string>): Promise<boolean> {
    if (this.db.permissionScope() !== 'relationship') return true;
    if (teamIds.has(c.id)) return true;
    return (await this.access.basis(c.patientId)) !== null;
  }

  async inTeam(caseId: string): Promise<boolean> {
    const me = this.db.actorUserId();
    if (!me) return false;
    return !!(await this.db.tx().surgeryCaseTeam.findFirst({
      where: { surgeryCaseId: caseId, userId: me, endedAt: null },
      select: { id: true },
    }));
  }

  async loadCase(id: string): Promise<CaseRow> {
    const row = await this.db.tx().surgeryCase.findUnique({
      where: { id },
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        roomId: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    });
    if (!row) throw new AppError('NOT_FOUND', 'Kasus operasi tidak ditemukan', 404);
    await this.assertCase(row);
    return row;
  }

  /** Kasus aktif (bukan batal/selesai) untuk ditulisi daftar tilik/peristiwa/hitung. */
  async activeCase(id: string): Promise<CaseRow> {
    const row = await this.loadCase(id);
    if (row.status === 'batal' || row.status === 'selesai') {
      throw new AppError('CONFLICT', `Kasus operasi sudah ${row.status}`, 409);
    }
    return row;
  }
}
