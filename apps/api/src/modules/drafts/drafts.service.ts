import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  AppError,
  CLINICAL_DRAFT_KIND_PATTERN,
  CLINICAL_DRAFT_MAX_PER_ENCOUNTER,
  type ClinicalDraft,
  type ClinicalDraftInput,
  newId,
} from '@simrs/shared';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

/** Jenis draf yang dikelola modul lain lewat endpoint khususnya (isi tervalidasi), bukan API draf generik. */
const RESERVED_DRAFT_KINDS: readonly string[] = ['resume'];

/**
 * ADR-0028 butir 5 · Draf klinis (bukan rekam medis): satu per penulis × kunjungan × jenis, hanya penulisnya yang
 * melihat, mengubah, dan menghapus (kunci baris = pengguna sesi; tidak ada endpoint untuk draf orang lain). Akses ke
 * pasien kunjungan tetap lewat ABAC; isi draf tidak masuk audit (hanya jenis dan pasien).
 */
@Injectable()
export class DraftsService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
  ) {}

  async get(encounterId: string, kind: string): Promise<ClinicalDraft> {
    const { userId, patientId } = await this.context(encounterId, kind);
    const row = await this.db.tx().clinicalDraft.findUnique({
      where: {
        tenantId_encounterId_kind_authorUserId: {
          tenantId: this.db.tenantId(),
          encounterId,
          kind,
          authorUserId: userId,
        },
      },
    });
    if (!row) throw new AppError('NOT_FOUND', 'Belum ada draf', 404);
    this.db.audit({
      action: 'read',
      resourceType: 'clinical_draft',
      resourceId: row.id,
      patientId,
      details: { kind },
    });
    return this.present(row);
  }

  async put(encounterId: string, kind: string, input: ClinicalDraftInput): Promise<ClinicalDraft> {
    const { userId, patientId } = await this.context(encounterId, kind);
    const tenantId = this.db.tenantId();
    const content = input.content as Prisma.InputJsonValue;
    const drafts = await this.db.tx().clinicalDraft.findMany({
      where: { encounterId, authorUserId: userId },
      select: { kind: true },
    });
    if (drafts.length >= CLINICAL_DRAFT_MAX_PER_ENCOUNTER && !drafts.some((d) => d.kind === kind)) {
      throw new AppError(
        'CONFLICT',
        `Draf Anda untuk kunjungan ini sudah ${CLINICAL_DRAFT_MAX_PER_ENCOUNTER}; simpan atau hapus draf lain dulu`,
        409,
      );
    }
    const row = await this.db.tx().clinicalDraft.upsert({
      where: {
        tenantId_encounterId_kind_authorUserId: { tenantId, encounterId, kind, authorUserId: userId },
      },
      update: { content },
      create: { id: newId(), tenantId, encounterId, patientId, authorUserId: userId, kind, content },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'clinical_draft',
      resourceId: row.id,
      patientId,
      details: { kind },
    });
    return this.present(row);
  }

  async remove(encounterId: string, kind: string): Promise<void> {
    const { userId, patientId } = await this.context(encounterId, kind);
    const { count } = await this.db.tx().clinicalDraft.deleteMany({
      where: { encounterId, kind, authorUserId: userId },
    });
    if (count > 0) {
      this.db.audit({
        action: 'update',
        resourceType: 'clinical_draft',
        patientId,
        details: { kind, deleted: true },
      });
    }
  }

  private async context(encounterId: string, kind: string) {
    if (!CLINICAL_DRAFT_KIND_PATTERN.test(kind)) {
      throw new AppError('VALIDATION_FAILED', 'Jenis draf tidak valid', 400);
    }
    if (RESERVED_DRAFT_KINDS.includes(kind)) {
      // Draf resume (K13) memuat konfirmasi rekonsiliasi DPJP: hanya lewat `/discharge/summaries` (divalidasi).
      throw new AppError(
        'VALIDATION_FAILED',
        'Draf resume disimpan lewat layar Resume (/discharge/summaries)',
        422,
      );
    }
    const { userId } = this.records.author();
    const enc = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: { patientId: true },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    await this.access.assert(enc.patientId);
    return { userId, patientId: enc.patientId };
  }

  private present(row: {
    encounterId: string;
    kind: string;
    content: unknown;
    updatedAt: Date;
  }): ClinicalDraft {
    return {
      encounterId: row.encounterId,
      kind: row.kind,
      content: row.content as Record<string, unknown>,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
