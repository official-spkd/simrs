import { Injectable } from '@nestjs/common';
import { allocateNumber, dbDateFromIso, isoFromDbDate } from '@simrs/db';
import {
  AppError,
  BPJS_RENCANA_KONTROL_DELETE_OPERATION,
  BPJS_RENCANA_KONTROL_INSERT_OPERATION,
  BPJS_RUJUKAN_DELETE_OPERATION,
  BPJS_RUJUKAN_INSERT_OPERATION,
  BPJS_SPRI_INSERT_OPERATION,
  type BpjsSyncStatus,
  type CancelReferralInput,
  type CreateControlLetterInput,
  type CreateInternalReferralInput,
  type CreateOutgoingReferralInput,
  type FrontOfficeOperation,
  frontOfficeError,
  isoDateJakarta,
  type ReferralList,
  type ReferralRecord,
  type ReferralStatus,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { RegistrationService } from '../registration/registration.service';
import { bpjsSyncMessage } from '../sep/sep.service';
import { type ReferralRow, ReferralRepository } from './referral.repository';

const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 422);
const stateInvalid = (message: string) => frontOfficeError('REFERRAL_STATE_INVALID', undefined, message);

/** Jenis yang nomornya dari BPJS (VClaim) bila kunjungannya BPJS. */
const INSERT_OPERATION: Partial<Record<string, FrontOfficeOperation>> = {
  'surat-kontrol': BPJS_RENCANA_KONTROL_INSERT_OPERATION,
  spri: BPJS_SPRI_INSERT_OPERATION,
  'rujukan-keluar': BPJS_RUJUKAN_INSERT_OPERATION,
};
const DELETE_OPERATION: Partial<Record<string, FrontOfficeOperation>> = {
  'surat-kontrol': BPJS_RENCANA_KONTROL_DELETE_OPERATION,
  spri: BPJS_RENCANA_KONTROL_DELETE_OPERATION,
  'rujukan-keluar': BPJS_RUJUKAN_DELETE_OPERATION,
};

type SourceEncounter = NonNullable<Awaited<ReturnType<ReferralRepository['sourceEncounter']>>>;

/**
 * F06 surat kontrol (rencana kontrol) + SPRI, F07 rujukan keluar dan internal (rencana fase 2 potongan 7), satu tabel
 * `referrals` berjenis:
 * - surat kontrol/SPRI/rujukan keluar kunjungan BPJS: baris `pending` tanpa nomor + outbox VClaim
 *   (`bpjs.vclaim.rencanakontrol.insert` / `spri.insert` / `rujukan.insert`, payload hanya `referralId`); worker
 *   mengisi nomor (`active`) atau status kirim `rejected`/`dead`. Gangguan BPJS tidak menggagalkan pembuatan (201);
 * - rujukan keluar non-BPJS dan rujukan internal: nomor RS sendiri (`RK-…`, `RIN-…`), tanpa kirim; rujukan internal
 *   memberi relasi `konsultan` ke dokter tujuan (ABAC);
 * - batal: yang sudah bernomor BPJS → `cancelled` + outbox hapus; yang belum bernomor dan gagal → batal lokal;
 *   kirim ulang setelah ditolak/DLQ dengan kunci outbox urut berikutnya (pola SEP 5a).
 * ABAC per pasien kunjungan asal (`PatientAccessService`); audit per pasien di transaksi yang sama.
 */
@Injectable()
export class ReferralService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: ReferralRepository,
    private readonly access: PatientAccessService,
    private readonly registration: RegistrationService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Baca
  // ------------------------------------------------------------------------------------------------------------

  async list(q: {
    cursor?: string;
    limit: number;
    patientId?: string;
    encounterId?: string;
    kind?: string;
    status?: string;
  }): Promise<ReferralList> {
    if (this.db.permissionScope() !== 'all') {
      if (!q.patientId && !q.encounterId) {
        throw invalid('Sebutkan pasien atau kunjungan (akses Anda terbatas pada pasien yang Anda rawat)');
      }
      const patientId = q.patientId ?? (await this.repo.sourceEncounter(q.encounterId as string))?.patientId;
      if (!patientId) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
      await this.access.assert(patientId);
    }
    const rows = await this.repo.list({ ...q, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    for (const patientId of new Set(page.map((r) => r.patientId))) {
      this.db.audit({ action: 'read', resourceType: 'referral', patientId, details: { list: true } });
    }
    return {
      items: page.map(toReferralRecord),
      nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async get(id: string): Promise<ReferralRecord> {
    const row = await this.load(id);
    this.audit(row, 'read');
    return toReferralRecord(row);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Buat
  // ------------------------------------------------------------------------------------------------------------

  /** Surat kontrol (butuh SEP kunjungan asal terbit) atau SPRI (butuh penjaminan BPJS); nomor dari BPJS. */
  async createControlLetter(input: CreateControlLetterInput): Promise<ReferralRecord> {
    const source = await this.source(input.encounterId);
    if (source.coverages[0]?.payer.kind !== 'bpjs' || !source.coverages[0].patientIdentifierId) {
      throw invalid('Surat kontrol/SPRI BPJS hanya untuk kunjungan berpenjamin BPJS');
    }
    const today = isoDateJakarta(new Date());
    if (input.plannedDate < today) throw invalid('Tanggal rencana tidak boleh sebelum hari ini');
    await this.dpjpWithHfis(input.practitionerId);
    const sep = source.seps[0];
    const diagnosis =
      input.diagnosis ??
      (sep?.diagnosisCode
        ? { code: sep.diagnosisCode, display: sep.diagnosisDisplay ?? sep.diagnosisCode }
        : null);
    const common = {
      patientId: source.patientId,
      encounterId: source.id,
      practitionerId: input.practitionerId,
      diagnosisCode: diagnosis?.code ?? null,
      diagnosisDisplay: diagnosis?.display ?? null,
      issuedOn: dbDateFromIso(today),
      plannedDate: dbDateFromIso(input.plannedDate),
      status: 'pending',
      syncStatus: 'pending',
      syncSeq: 1,
    } as const;
    let row: ReferralRow;
    if (input.kind === 'surat-kontrol') {
      if (sep?.status !== 'issued' || !sep.sepNo) {
        throw frontOfficeError(
          'SEP_STATE_INVALID',
          undefined,
          'Surat kontrol butuh SEP kunjungan asal yang sudah terbit',
        );
      }
      const poli = await this.repo.poliService(input.targetServiceId);
      if (!poli || !poli.active || poli.kind !== 'poli')
        throw invalid('Poli tujuan tidak ditemukan atau nonaktif');
      if (!(await this.repo.externalId('queue_service', poli.id, 'bpjs:poli'))) {
        throw invalid('Kode poli BPJS poli tujuan belum dipetakan');
      }
      row = await this.repo.create({
        ...common,
        kind: 'surat-kontrol',
        facilityName: source.service?.name ?? source.unit.name,
        targetServiceId: poli.id,
        // Surat kontrol berlaku untuk tanggal rencananya.
        validUntil: dbDateFromIso(input.plannedDate),
      });
    } else {
      const unit = await this.repo.unit(input.unitId);
      if (!unit || !unit.active || unit.kind !== 'rawat_inap') {
        throw invalid('Unit tujuan bukan unit rawat inap yang aktif');
      }
      const poli = await this.repo.practitionerBpjsPoli(input.practitionerId);
      if (!poli) throw invalid('Poli BPJS DPJP belum diketahui (jadwal praktik dengan kode poli BPJS)');
      row = await this.repo.create({
        ...common,
        kind: 'spri',
        facilityName: unit.name,
        targetServiceId: poli.serviceId,
        targetUnitId: unit.id,
      });
    }
    await this.repo.enqueue(INSERT_OPERATION[row.kind] as FrontOfficeOperation, row.id, 1);
    this.audit(row, 'create');
    return toReferralRecord(row);
  }

  /** Rujukan keluar: kunjungan BPJS → nomor VClaim lewat outbox (butuh SEP terbit); selain itu nomor RS `RK-…`. */
  async createOutgoing(input: CreateOutgoingReferralInput): Promise<ReferralRecord> {
    const source = await this.source(input.encounterId);
    const today = isoDateJakarta(new Date());
    if (input.plannedDate < today) throw invalid('Tanggal rencana kunjungan tidak boleh sebelum hari ini');
    const bpjs = source.coverages[0]?.payer.kind === 'bpjs';
    const sep = source.seps[0];
    if (bpjs && (sep?.status !== 'issued' || !sep.sepNo)) {
      throw frontOfficeError(
        'SEP_STATE_INVALID',
        undefined,
        'Rujukan keluar BPJS butuh SEP kunjungan yang sudah terbit',
      );
    }
    const row = await this.repo.create({
      kind: 'rujukan-keluar',
      patientId: source.patientId,
      encounterId: source.id,
      number: bpjs ? null : (await allocateNumber(this.db.tx(), this.db.tenantId(), 'referral_out')).number,
      status: bpjs ? 'pending' : 'active',
      ppkCode: input.destination.ppkCode,
      facilityName: input.destination.name,
      serviceType: input.serviceType,
      referralType: input.referralType,
      bpjsPoliCode: input.bpjsPoliCode ?? null,
      diagnosisCode: input.diagnosis.code,
      diagnosisDisplay: input.diagnosis.display,
      note: input.note || null,
      issuedOn: dbDateFromIso(today),
      plannedDate: dbDateFromIso(input.plannedDate),
      syncStatus: bpjs ? 'pending' : 'not_required',
      syncSeq: 1,
    });
    if (bpjs) await this.repo.enqueue(BPJS_RUJUKAN_INSERT_OPERATION, row.id, 1);
    this.audit(row, 'create');
    return toReferralRecord(row);
  }

  /** Rujukan internal antarpoli (konsul): nomor RS `RIN-…`; dokter tujuan mendapat relasi `konsultan`. */
  async createInternal(input: CreateInternalReferralInput): Promise<ReferralRecord> {
    const source = await this.source(input.encounterId);
    const poli = await this.repo.poliService(input.targetServiceId);
    if (!poli || !poli.active || poli.kind !== 'poli')
      throw invalid('Poli tujuan tidak ditemukan atau nonaktif');
    if (poli.id === source.serviceId) throw invalid('Poli tujuan sama dengan poli asal');
    if (input.practitionerId) {
      const p = await this.repo.practitioner(input.practitionerId);
      if (!p || !p.active) throw invalid('Dokter tujuan tidak ditemukan atau nonaktif');
    }
    const today = isoDateJakarta(new Date());
    const row = await this.repo.create({
      kind: 'rujukan-internal',
      patientId: source.patientId,
      encounterId: source.id,
      number: (await allocateNumber(this.db.tx(), this.db.tenantId(), 'referral_internal')).number,
      status: 'active',
      facilityName: source.service?.name ?? source.unit.name,
      targetServiceId: poli.id,
      practitionerId: input.practitionerId ?? null,
      diagnosisCode: input.diagnosis?.code ?? null,
      diagnosisDisplay: input.diagnosis?.display ?? null,
      note: input.reason,
      issuedOn: dbDateFromIso(today),
      syncStatus: 'not_required',
    });
    if (input.practitionerId) {
      await this.registration.grantDpjpAccess(
        input.practitionerId,
        source.patientId,
        source.id,
        today,
        'konsultan',
      );
    }
    this.audit(row, 'create');
    return toReferralRecord(row);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Batal dan kirim ulang
  // ------------------------------------------------------------------------------------------------------------

  async cancel(id: string, input: CancelReferralInput): Promise<ReferralRecord> {
    const row = await this.lockAndLoad(id);
    if (row.kind === 'rujukan-fktp' || row.kind === 'rujukan-rs') {
      throw stateInvalid('Rujukan masuk tidak dibatalkan di sini');
    }
    if (row.status !== 'pending' && row.status !== 'active') {
      throw stateInvalid(`Rujukan berstatus ${row.status} tidak bisa dibatalkan`);
    }
    if (row.kind === 'spri' && (await this.repo.admissionForReferral(row.id))) {
      throw stateInvalid('SPRI sudah dipakai admisi; batalkan admisinya lebih dulu');
    }
    const cancel = {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: this.db.actorUserId(),
      cancelReason: input.reason,
    };
    let updated: ReferralRow;
    const del = DELETE_OPERATION[row.kind];
    if (row.syncStatus !== 'not_required' && row.number && del) {
      // Sudah bernomor di BPJS: hapus di BPJS lewat outbox.
      const seq = row.syncSeq + 1;
      updated = await this.repo.update(id, {
        ...cancel,
        syncStatus: 'pending',
        syncErrorCode: null,
        syncSeq: seq,
      });
      await this.repo.enqueue(del, id, seq);
    } else {
      if (row.syncStatus === 'pending') {
        throw stateInvalid('Masih dikirim ke BPJS; tunggu nomornya terbit atau gagal, lalu batalkan');
      }
      updated = await this.repo.update(id, cancel);
    }
    this.audit(updated, 'update', input.reason, { status: 'cancelled' });
    return toReferralRecord(updated);
  }

  /** Kirim ulang setelah ditolak BPJS / DLQ: terbitkan (belum bernomor) atau hapus (sudah batal). */
  async retry(id: string): Promise<ReferralRecord> {
    const row = await this.lockAndLoad(id);
    if (row.syncStatus !== 'rejected' && row.syncStatus !== 'dead') {
      throw stateInvalid('Kirim ulang hanya untuk surat/rujukan yang ditolak atau gagal dikirim ke BPJS');
    }
    const op =
      row.status === 'pending'
        ? INSERT_OPERATION[row.kind]
        : row.status === 'cancelled'
          ? DELETE_OPERATION[row.kind]
          : undefined;
    if (!op) throw stateInvalid(`Rujukan berstatus ${row.status} tidak bisa dikirim ulang`);
    const seq = row.syncSeq + 1;
    const updated = await this.repo.update(id, { syncStatus: 'pending', syncErrorCode: null, syncSeq: seq });
    await this.repo.enqueue(op, id, seq);
    this.audit(updated, 'update', null, { action: 'retry', previousError: row.syncErrorCode });
    return toReferralRecord(updated);
  }

  // ------------------------------------------------------------------------------------------------------------

  private async source(encounterId: string): Promise<SourceEncounter> {
    const e = await this.repo.sourceEncounter(encounterId);
    if (!e) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    if (this.db.permissionScope() !== 'all') await this.access.assert(e.patientId);
    if (e.status === 'cancelled') {
      throw frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, 'Kunjungan asal sudah dibatalkan');
    }
    return e;
  }

  private async dpjpWithHfis(practitionerId: string): Promise<void> {
    const p = await this.repo.practitioner(practitionerId);
    if (!p || !p.active || p.profession !== 'dokter') throw invalid('DPJP tidak ditemukan atau nonaktif');
    if (!(await this.repo.externalId('practitioner', p.id, 'bpjs:hfis-dokter'))) {
      throw invalid('Kode DPJP BPJS (HFIS) dokter belum dipetakan');
    }
  }

  private async load(id: string): Promise<ReferralRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'Rujukan tidak ditemukan', 404);
    if (this.db.permissionScope() !== 'all') await this.access.assert(row.patientId);
    return row;
  }

  private async lockAndLoad(id: string): Promise<ReferralRow> {
    if (!(await this.repo.lock(id))) throw new AppError('NOT_FOUND', 'Rujukan tidak ditemukan', 404);
    return this.load(id);
  }

  private audit(
    row: ReferralRow,
    action: 'read' | 'create' | 'update',
    reason: string | null = null,
    details?: Record<string, unknown>,
  ): void {
    this.db.audit({
      action,
      resourceType: 'referral',
      resourceId: row.id,
      patientId: row.patientId,
      reason,
      details: { kind: row.kind, ...details },
    });
  }
}

export function toReferralRecord(row: ReferralRow): ReferralRecord {
  const code = row.syncErrorCode;
  return {
    id: row.id,
    kind: row.kind as ReferralRecord['kind'],
    status: row.status as ReferralStatus,
    number: row.number,
    patientId: row.patientId,
    encounterId: row.encounterId,
    ppkCode: row.ppkCode,
    facilityName: row.facilityName,
    targetServiceId: row.targetServiceId,
    practitionerId: row.practitionerId,
    diagnosis: row.diagnosisCode
      ? { code: row.diagnosisCode, display: row.diagnosisDisplay ?? row.diagnosisCode }
      : null,
    issuedOn: isoFromDbDate(row.issuedOn),
    validUntil: row.validUntil ? isoFromDbDate(row.validUntil) : null,
    visitNo: row.visitNo,
    plannedDate: row.plannedDate ? isoFromDbDate(row.plannedDate) : null,
    targetUnitId: row.targetUnitId,
    serviceType: row.serviceType as ReferralRecord['serviceType'],
    referralType: row.referralType as ReferralRecord['referralType'],
    bpjsPoliCode: row.bpjsPoliCode,
    note: row.note,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    sync: {
      status: row.syncStatus as BpjsSyncStatus,
      sentAt: row.syncedAt?.toISOString() ?? null,
      error: code ? { code, message: bpjsSyncMessage(code) } : null,
    },
    createdAt: row.createdAt.toISOString(),
  };
}
