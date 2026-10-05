import { Injectable } from '@nestjs/common';
import type { EncounterAssessment } from '@simrs/shared';
import { clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

/**
 * K06 · Asesmen per kunjungan. Asesmen DIISI lewat formulir P07 (`POST /patients/:id/forms/:code/responses` dengan
 * `encounterId`; hak tulis per profesi `write_roles`, ADR-0019; koreksi berversi di modul formulir). Modul ini membaca
 * isian terkini satu kunjungan untuk layar klinis; kelengkapan paket formulir per setting menyusul potongan 3.8.
 */
@Injectable()
export class AssessmentService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
  ) {}

  async forEncounter(encounterId: string): Promise<EncounterAssessment[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().formResponse.findMany({
      where: { encounterId: enc.id, supersededBy: { none: {} } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        rootId: true,
        formCode: true,
        version: true,
        status: true,
        score: true,
        scoreBand: true,
        createdAt: true,
        createdBy: true,
        definition: { select: { title: true, version: true } },
      },
    });
    const names = await this.records.userNames(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])));
    this.db.audit({
      action: 'read',
      resourceType: 'form_response',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return rows.map((r) => ({
      id: r.id,
      rootId: r.rootId,
      formCode: r.formCode,
      formTitle: r.definition.title,
      formVersion: r.definition.version,
      version: r.version,
      status: r.status as EncounterAssessment['status'],
      score: r.score,
      scoreBand: r.scoreBand,
      createdAt: r.createdAt.toISOString(),
      author: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    }));
  }
}
