import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CreateConsentInput,
  PRIVACY_CONSENT_LABEL,
  type PrivacyConsentKind,
  type RevokeConsentInput,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { type ConsentRow, MpiRepository } from './mpi.repository';

export interface ConsentView {
  id: string;
  kind: PrivacyConsentKind;
  label: string;
  recipient: string | null;
  note: string | null;
  active: boolean;
  givenAt: string;
  givenBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

/**
 * P05 · Persetujuan privasi pasien (docs/05 §1, UU PDP): persetujuan umum dan pembukaan data ke pihak ketiga.
 * Dicatat atas nama petugas, dicabut dengan alasan, tidak pernah dihapus. Audit lewat `@Audited` di controller.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: MpiRepository,
    private readonly access: PatientAccessService,
  ) {}

  private async assertPatient(patientId: string, forWrite: boolean): Promise<void> {
    if (this.db.permissionScope() !== 'all') await this.access.assert(patientId);
    const p = await this.repo.findById(patientId);
    if (!p) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (forWrite && p.status === 'merged') {
      throw new AppError(
        'CONFLICT',
        `Rekam medis ini sudah digabung ke RM ${p.mergedInto?.mrn ?? '-'}; catat persetujuan di rekam medis tersebut`,
        409,
      );
    }
  }

  async list(patientId: string): Promise<ConsentView[]> {
    await this.assertPatient(patientId, false);
    const rows = await this.repo.listConsents(patientId);
    const names = await this.repo.userNames(rows.flatMap((r) => [r.givenBy, r.revokedBy]));
    return rows.map((r) => this.present(r, names));
  }

  async create(patientId: string, input: CreateConsentInput): Promise<ConsentView> {
    await this.assertPatient(patientId, true);
    const recipient = input.kind === 'pembukaan_data' ? (input.recipient ?? null) : null;
    if (await this.repo.findActiveConsent(patientId, input.kind, recipient)) {
      throw new AppError('CONFLICT', 'Persetujuan ini sudah tercatat dan masih berlaku', 409);
    }
    const row = await this.repo.createConsent({
      patientId,
      kind: input.kind,
      recipient,
      note: input.note ?? null,
    });
    return this.present(row, await this.repo.userNames([row.givenBy]));
  }

  async revoke(patientId: string, consentId: string, input: RevokeConsentInput): Promise<ConsentView> {
    await this.assertPatient(patientId, false);
    const row = await this.repo.findConsent(consentId);
    if (!row || row.patientId !== patientId)
      throw new AppError('NOT_FOUND', 'Persetujuan tidak ditemukan', 404);
    if (row.revokedAt) throw new AppError('CONFLICT', 'Persetujuan ini sudah dicabut', 409);
    const updated = await this.repo.revokeConsent(consentId, input.reason);
    return this.present(updated, await this.repo.userNames([updated.givenBy, updated.revokedBy]));
  }

  private present(r: ConsentRow, names: Map<string, string>): ConsentView {
    const kind = r.kind as PrivacyConsentKind;
    return {
      id: r.id,
      kind,
      label: PRIVACY_CONSENT_LABEL[kind] ?? r.kind,
      recipient: r.recipient,
      note: r.note,
      active: r.revokedAt === null,
      givenAt: r.givenAt.toISOString(),
      givenBy: r.givenBy ? (names.get(r.givenBy) ?? null) : null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokedBy: r.revokedBy ? (names.get(r.revokedBy) ?? null) : null,
      revokeReason: r.revokeReason,
    };
  }
}
