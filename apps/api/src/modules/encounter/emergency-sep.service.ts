import { Injectable } from '@nestjs/common';
import {
  AppError,
  type EmergencySepInput,
  frontOfficeError,
  type Icd10Coding,
  VCLAIM_POLI_IGD,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { SepService } from '../sep/sep.service';

/**
 * F06/K03 · SEP IGD otomatis (utang fase 2): kunjungan IGD dengan penjaminan BPJS mendapat SEP rawat jalan poli
 * `VCLAIM_POLI_IGD` (ASUMSI, lihat shared) tanpa rujukan, lewat pola SEP 5a (`createPending` + outbox
 * `bpjs.vclaim.sep.insert`). Diagnosa awal dari registrasi IGD bila diisi, atau menyusul dari dokter jaga lewat
 * `POST /api/v1/encounters/:id/emergency-sep`. Satu rantai SEP per kunjungan (indeks database).
 */
@Injectable()
export class EmergencySepService {
  constructor(
    private readonly db: TenantDb,
    private readonly sep: SepService,
    private readonly access: PatientAccessService,
  ) {}

  async request(encounterId: string, input: EmergencySepInput): Promise<{ sepId: string }> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({ where: { id: encounterId } });
    if (!enc || enc.encounterClass !== 'EMER')
      throw new AppError('NOT_FOUND', 'Kunjungan IGD tidak ditemukan', 404);
    if (enc.status === 'cancelled') {
      throw frontOfficeError('ENCOUNTER_STATE_INVALID', undefined, 'Kunjungan IGD sudah dibatalkan');
    }
    if (this.db.permissionScope() !== 'all') await this.access.assert(enc.patientId);
    const sepId = await this.create(enc.id, input.initialDiagnosis, input.note);
    this.db.audit({ action: 'create', resourceType: 'sep', resourceId: sepId, patientId: enc.patientId });
    return { sepId };
  }

  /** Dipakai juga registrasi IGD: buat SEP IGD `pending` bila penjaminan BPJS aktif dan belum ada SEP. */
  async create(encounterId: string, diagnosis: Icd10Coding, note: string | null): Promise<string> {
    const tx = this.db.tx();
    const coverage = await tx.coverage.findFirst({
      where: { encounterId, status: 'active', payer: { kind: 'bpjs' } },
      orderBy: { priority: 'asc' },
      select: { id: true },
    });
    if (!coverage) {
      throw new AppError('VALIDATION_FAILED', 'Kunjungan IGD ini belum berpenjamin BPJS', 422);
    }
    if (await tx.sep.findFirst({ where: { encounterId }, select: { id: true } })) {
      throw frontOfficeError('SEP_DUPLICATE');
    }
    return this.sep.createPending({
      encounterId,
      coverageId: coverage.id,
      referralId: null,
      poliCode: VCLAIM_POLI_IGD,
      diagnosis,
      note,
      serviceType: 'rawat_jalan',
    });
  }
}
