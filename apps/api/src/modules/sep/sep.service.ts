import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  BPJS_SEP_DELETE_OPERATION,
  BPJS_SEP_INSERT_OPERATION,
  BPJS_SEP_UPDATE_OPERATION,
  type BpjsParticipantLookupInput,
  bpjsStaffMessage,
  type BpjsSyncStatus,
  type CancelSepInput,
  type EligibilityResult,
  frontOfficeError,
  type Icd10Coding,
  ICD10_PATTERN,
  isoDateJakarta,
  maskIdentifier,
  newId,
  type Referral,
  type ReviseSepInput,
  type Sep,
  type SepStatus,
  VCLAIM_PESERTA_AKTIF,
  VCLAIM_RUJUKAN_BERLAKU_HARI,
  type VclaimPeserta,
  type VclaimRujukan,
  vclaimRujukanBerlakuSampai,
} from '@simrs/shared';
import { dbDateFromIso, isoFromDbDate } from '@simrs/db';
import { PatientCrypto } from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
import { LookupGateway } from '../../infra/lookup/lookup.gateway';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import {
  BPJS_LOOKUP_CLIENT,
  type BpjsLookupClient,
  pesertaConnector,
  rujukanListConnector,
} from './bpjs-lookup';
import { type SepRow, SepRepository } from './sep.repository';

const KELAS: Record<string, EligibilityResult['eligibility']['kelas']> = {
  '1': 'Kelas 1',
  '2': 'Kelas 2',
  '3': 'Kelas 3',
};

/** Pesan petugas untuk kode galat status kirim BPJS: pesan baku dari kode, tidak pernah teks asli BPJS. */
export const bpjsSyncMessage = (code: string) => bpjsStaffMessage(code);
const syncMessage = bpjsSyncMessage;

/** Kode kegagalan SEP yang butuh arahan lebih spesifik dari label umum. */
const SEP_FAILURE_MESSAGES: Record<string, string> = {
  BPJS_SEP_GANDA:
    'Peserta sudah memiliki SEP pada tanggal ini yang bukan milik kunjungan ini; periksa histori SEP di VClaim',
  BPJS_PESERTA_TIDAK_AKTIF: 'Status kepesertaan BPJS tidak aktif; cek kepesertaan untuk rinciannya',
};

/**
 * Alasan kegagalan SEP untuk petugas: pesan baku dari `last_error_code`. Teks asli BPJS tetap di
 * `seps.rejection_reason` untuk ditinjau di database, tidak pernah dikirim ke layar maupun log (review keamanan
 * fase 2).
 */
export function sepFailureMessage(code: string | null): string {
  return (code && SEP_FAILURE_MESSAGES[code]) || bpjsStaffMessage(code);
}
const invalidState = (message: string) => frontOfficeError('SEP_STATE_INVALID', undefined, message);

export interface PendingSepInput {
  encounterId: string;
  coverageId: string;
  referralId: string | null;
  poliCode: string | null;
  diagnosis: Icd10Coding;
  note: string | null;
}

/**
 * F06 · SEP berversi (rencana fase 2 potongan 5a):
 * - registrasi BPJS membuat versi 1 `pending` + outbox `bpjs.vclaim.sep.insert` (gangguan BPJS tidak menggagalkan
 *   registrasi); worker menerbitkan, menyimpan kelas hak peserta, mengunci penjaminan, dan memeriksa SEP yang sudah
 *   ada (histori) bila BPJS menjawab SEP ganda, sehingga SEP tidak pernah terbit dua kali;
 * - SEP terbit beku (trigger `app_sep_guard`): revisi = versi baru `pending` + `bpjs.vclaim.sep.update`;
 * - batal = SEP terbit → `cancelled` + `bpjs.vclaim.sep.delete`; kirim ulang setelah ditolak/DLQ dengan kunci outbox
 *   baru (`<operasi>:<sep>:<urut>`).
 * Lookup kepesertaan dan rujukan sinkron lewat `LookupGateway` (ADR-0025), di luar transaksi permintaan.
 */
@Injectable()
export class SepService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(BPJS_LOOKUP_CLIENT) private readonly bpjs: BpjsLookupClient,
    private readonly db: TenantDb,
    private readonly repo: SepRepository,
    private readonly access: PatientAccessService,
    private readonly lookups: LookupGateway,
  ) {}

  private crypto(): PatientCrypto {
    return new PatientCrypto(this.env.fieldKeys, this.db.tenantId());
  }

  // ------------------------------------------------------------------------------------------------------------
  // Dipakai registrasi (transaksi permintaan registrasi)
  // ------------------------------------------------------------------------------------------------------------

  /** SEP versi 1 `pending` + pesan terbitkan SEP. Satu rantai per kunjungan (indeks unik database). */
  async createPending(input: PendingSepInput): Promise<string> {
    const id = newId();
    await this.repo.create({
      id,
      encounterId: input.encounterId,
      coverageId: input.coverageId,
      referralId: input.referralId,
      status: 'pending',
      serviceType: 'rawat_jalan',
      poliCode: input.poliCode,
      diagnosisCode: input.diagnosis.code,
      diagnosisDisplay: input.diagnosis.display,
      note: input.note,
      syncStatus: 'pending',
      syncSeq: 1,
    });
    await this.repo.enqueue(BPJS_SEP_INSERT_OPERATION, id, 1);
    return id;
  }

  async latestForEncounter(encounterId: string): Promise<Sep | null> {
    const row = await this.repo.latestForEncounter(encounterId);
    return row ? toSep(row) : null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Endpoint SEP
  // ------------------------------------------------------------------------------------------------------------

  async get(id: string): Promise<Sep> {
    const row = await this.load(id);
    this.audit(row, 'read');
    return toSep(row);
  }

  /** Revisi SEP terbit = versi baru `pending` (nomor SEP sama) + `bpjs.vclaim.sep.update`. */
  async revise(id: string, input: ReviseSepInput): Promise<Sep> {
    const current = await this.lockLatest(id);
    if (current.status !== 'issued') {
      throw invalidState(`SEP berstatus ${current.status} tidak bisa direvisi; hanya SEP terbit`);
    }
    const next = newId();
    const created = await this.repo.create({
      id: next,
      encounterId: current.encounterId,
      coverageId: current.coverageId,
      referralId: current.referralId,
      version: current.version + 1,
      supersedesId: current.id,
      correctionReason: input.reason,
      status: 'pending',
      sepNo: current.sepNo,
      serviceType: current.serviceType,
      careClass: current.careClass,
      poliCode: current.poliCode,
      diagnosisCode: input.initialDiagnosis?.code ?? current.diagnosisCode,
      diagnosisDisplay: input.initialDiagnosis?.display ?? current.diagnosisDisplay,
      note: input.note ?? current.note,
      syncStatus: 'pending',
      syncSeq: 1,
    });
    await this.repo.enqueue(BPJS_SEP_UPDATE_OPERATION, next, 1);
    this.audit(created, 'update', input.reason, {
      supersedes: current.id,
      fields: Object.keys(input)
        .filter((k) => k !== 'reason')
        .sort(),
    });
    return toSep(created);
  }

  /**
   * Kirim ulang setelah ditolak BPJS atau DLQ: SEP `failed` (terbit/revisi) → `pending` lagi; SEP batal yang
   * hapusnya ditolak/DLQ → hapus dikirim ulang. Pesan baru berkunci urut berikutnya.
   */
  async retry(id: string): Promise<Sep> {
    const current = await this.lockLatest(id);
    const seq = current.syncSeq + 1;
    if (current.status === 'failed') {
      const updated = await this.repo.update(id, {
        status: 'pending',
        lastErrorCode: null,
        rejectionReason: null,
        syncStatus: 'pending',
        syncErrorCode: null,
        syncSeq: seq,
      });
      await this.repo.enqueue(
        current.version === 1 ? BPJS_SEP_INSERT_OPERATION : BPJS_SEP_UPDATE_OPERATION,
        id,
        seq,
      );
      this.audit(updated, 'update', null, { action: 'retry', previousError: current.lastErrorCode });
      return toSep(updated);
    }
    if (
      current.status === 'cancelled' &&
      (current.syncStatus === 'rejected' || current.syncStatus === 'dead')
    ) {
      const updated = await this.repo.update(id, {
        syncStatus: 'pending',
        syncErrorCode: null,
        syncSeq: seq,
      });
      await this.repo.enqueue(BPJS_SEP_DELETE_OPERATION, id, seq);
      this.audit(updated, 'update', null, { action: 'retry_cancel', previousError: current.syncErrorCode });
      return toSep(updated);
    }
    throw invalidState('Kirim ulang hanya untuk SEP yang gagal/ditolak BPJS atau hapus SEP yang gagal');
  }

  /** Batal SEP terbit: `cancelled` + `bpjs.vclaim.sep.delete`. */
  async cancel(id: string, input: CancelSepInput): Promise<Sep> {
    const current = await this.lockLatest(id);
    if (current.status !== 'issued') {
      throw invalidState(`SEP berstatus ${current.status} tidak bisa dibatalkan; hanya SEP terbit`);
    }
    const seq = current.syncSeq + 1;
    const updated = await this.repo.update(id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: this.db.actorUserId(),
      cancelReason: input.reason,
      syncStatus: 'pending',
      syncErrorCode: null,
      syncSeq: seq,
    });
    await this.repo.enqueue(BPJS_SEP_DELETE_OPERATION, id, seq);
    this.audit(updated, 'update', input.reason, { status: 'cancelled' });
    return toSep(updated);
  }

  /** Audit per SEP dengan pasiennya (kolom `patientId`), tanpa PHI di rincian. */
  private audit(
    row: SepRow,
    action: 'read' | 'update',
    reason: string | null = null,
    details?: Record<string, unknown>,
  ): void {
    this.db.audit({
      action,
      resourceType: 'sep',
      resourceId: row.id,
      patientId: row.encounter.patientId,
      reason,
      details: { version: row.version, ...details },
    });
  }

  private async load(id: string): Promise<SepRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'SEP tidak ditemukan', 404);
    await this.assertAccess(row.encounter.patientId);
    return row;
  }

  /** Kunci baris lalu pastikan ini versi terbaru (tindakan atas versi lama → 409). */
  private async lockLatest(id: string): Promise<SepRow> {
    if (!(await this.repo.lock(id))) throw new AppError('NOT_FOUND', 'SEP tidak ditemukan', 404);
    const row = await this.load(id);
    if (row._count.supersededBy > 0) {
      throw invalidState('SEP ini sudah digantikan versi yang lebih baru; pakai versi terbaru');
    }
    return row;
  }

  private async assertAccess(patientId: string): Promise<void> {
    if (this.db.permissionScope() !== 'all') await this.access.assert(patientId);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Lookup sinkron (handler @NoRequestTransaction)
  // ------------------------------------------------------------------------------------------------------------

  /** Cek kepesertaan JKN (tersamar). Peserta tidak aktif = hasil; tidak ditemukan = 422 `BPJS_REJECTED`. */
  async eligibility(input: BpjsParticipantLookupInput, patientId?: string): Promise<EligibilityResult> {
    if (patientId) {
      await this.db.transaction(async () => {
        const p = await this.repo.patientCard(patientId);
        if (!p) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
        await this.assertAccess(patientId);
      });
    }
    const peserta = await this.lookups.lookup(
      pesertaConnector(this.bpjs),
      { ...input, date: isoDateJakarta(new Date()) },
      { patientId: patientId ?? null },
    );
    return { eligibility: toEligibility(peserta), checkedAt: new Date().toISOString() };
  }

  /**
   * Rujukan FKTP (VClaim, per no. kartu pasien) + surat kontrol aktif milik RS. Hasil VClaim disimpan di `referrals`
   * (dasar SEP saat registrasi): nomor milik pasien lain tidak pernah ditampilkan/ditimpa.
   */
  async referrals(patientId: string): Promise<{ referrals: Referral[]; checkedAt: string }> {
    const card = await this.db.transaction(async () => {
      const p = await this.repo.patientCard(patientId);
      if (!p) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
      await this.assertAccess(patientId);
      const enc = p.identifiers[0]?.valueEnc;
      return enc ? this.crypto().decryptIdentifier(enc) : null;
    });
    const today = isoDateJakarta(new Date());
    const persist = async (list: VclaimRujukan[]) => {
      const fktp = await this.persistReferrals(patientId, list, today);
      const letters = (await this.repo.activeControlLetters(patientId)).flatMap((r): Referral[] => {
        const code = r.diagnosisCode;
        if (!r.number || !code || !ICD10_PATTERN.test(code) || !r.targetService) return [];
        return [
          {
            id: r.id,
            kind: 'surat-kontrol',
            number: r.number,
            title: 'Surat kontrol',
            origin: r.facilityName,
            diagnosis: { code, label: r.diagnosisDisplay ?? code },
            issuedAt: isoFromDbDate(r.issuedOn),
            validUntil: isoFromDbDate(r.validUntil ?? r.issuedOn),
            visitNo: null,
            poliCode: r.targetService.code,
            doctorId: r.practitionerId,
          },
        ];
      });
      return { referrals: [...letters, ...fktp], checkedAt: new Date().toISOString() };
    };
    if (!card) {
      // Tanpa no. kartu tidak ada rujukan FKTP yang bisa dicek; surat kontrol RS tetap tampil.
      return this.db.transaction(async () => {
        this.db.audit({ action: 'read', resourceType: 'referral', patientId, details: { source: 'local' } });
        return persist([]);
      });
    }
    return this.lookups.lookup(rujukanListConnector(this.bpjs), { noKartu: card }, { patientId, persist });
  }

  /** Simpan rujukan FKTP hasil VClaim (upsert per nomor) dan bentuk model tampilannya. */
  private async persistReferrals(
    patientId: string,
    list: VclaimRujukan[],
    today: string,
  ): Promise<Referral[]> {
    const poli = await this.repo.poliServicesByBpjsCode();
    const out: Referral[] = [];
    for (const r of list) {
      const service = poli.get(r.poliRujukan.kode);
      const diagnosisOk = ICD10_PATTERN.test(r.diagnosa.kode);
      const validUntil = vclaimRujukanBerlakuSampai(r.tglKunjungan);
      const status = validUntil < today ? 'expired' : 'active';
      const existing = await this.repo.findReferral('rujukan-fktp', r.noKunjungan);
      if (existing && existing.patientId !== patientId) continue;
      const id = existing
        ? (
            await this.repo.updateReferral(existing.id, {
              validUntil: dbDateFromIso(validUntil),
              status,
              targetServiceId: service?.id ?? null,
            })
          ).id
        : (
            await this.repo.createReferral({
              patientId,
              kind: 'rujukan-fktp',
              number: r.noKunjungan,
              ppkCode: r.provPerujuk.kode,
              facilityName: r.provPerujuk.nama.slice(0, 160),
              targetServiceId: service?.id ?? null,
              diagnosisCode: diagnosisOk ? r.diagnosa.kode : null,
              diagnosisDisplay: diagnosisOk ? r.diagnosa.nama.slice(0, 200) : null,
              issuedOn: dbDateFromIso(r.tglKunjungan),
              validUntil: dbDateFromIso(validUntil),
              status,
            })
          ).id;
      // Model tampilan butuh poli RS dan kode ICD-10 baku; rujukan ke poli yang belum dipetakan tidak ditampilkan.
      if (!service || !diagnosisOk) continue;
      out.push({
        id,
        kind: 'rujukan-fktp',
        number: r.noKunjungan,
        title: `Rujukan FKTP (berlaku ${VCLAIM_RUJUKAN_BERLAKU_HARI} hari)`,
        origin: r.provPerujuk.nama,
        diagnosis: { code: r.diagnosa.kode, label: r.diagnosa.nama },
        issuedAt: r.tglKunjungan,
        validUntil,
        visitNo: null,
        poliCode: service.code,
        doctorId: null,
      });
    }
    return out;
  }
}

function toEligibility(p: VclaimPeserta): EligibilityResult['eligibility'] {
  return {
    status: p.statusPeserta.kode === VCLAIM_PESERTA_AKTIF ? 'aktif' : 'tidak-aktif',
    cardMasked: maskIdentifier('bpjs', p.noKartu),
    kelas: KELAS[p.hakKelas.kode] ?? 'Kelas 3',
    segment: p.jenisPeserta.keterangan || '-',
    fktp: p.provUmum.nmProvider || '-',
  };
}

export function toSep(row: SepRow): Sep {
  const errorCode = row.syncErrorCode;
  return {
    id: row.id,
    encounterId: row.encounterId,
    coverageId: row.coverageId,
    referralId: row.referralId,
    version: row.version,
    supersedesId: row.supersedesId,
    correctionReason: row.correctionReason,
    status: row.status as SepStatus,
    sepNo: row.sepNo,
    serviceType: row.serviceType as Sep['serviceType'],
    careClass: row.careClass as Sep['careClass'],
    bpjsPoliCode: row.poliCode,
    initialDiagnosis: row.diagnosisCode
      ? { code: row.diagnosisCode, display: row.diagnosisDisplay ?? row.diagnosisCode }
      : null,
    lastErrorCode: row.lastErrorCode,
    rejectionReason: row.status === 'failed' ? sepFailureMessage(row.lastErrorCode) : null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    sync: {
      status: row.syncStatus as BpjsSyncStatus,
      sentAt: row.syncedAt?.toISOString() ?? null,
      error: errorCode ? { code: errorCode, message: syncMessage(errorCode) } : null,
    },
  };
}
