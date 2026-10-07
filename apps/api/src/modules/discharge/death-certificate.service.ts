import { Injectable } from '@nestjs/common';
import { getConcept } from '@simrs/db';
import {
  AppError,
  type ClinicalAuthor,
  type DeathCertificate,
  type DeathCertificateInput,
  formatTanggalWaktu,
  occurredInFuture,
  type SignatureStatus,
} from '@simrs/shared';
import { clinicalEncounter, lockClinicalKey } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../../infra/clinical/clinical-signing.service';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { DischargeAuthority } from './discharge-authority';

type DeathRow = {
  id: string;
  rootId: string;
  version: number;
  encounterId: string;
  patientId: string;
  diedAt: Date;
  code: string;
  display: string;
  note: string | null;
  authorUserId: string;
  authorRole: string;
  recordedAt: Date;
};

/**
 * K13 · Surat keterangan kematian (keputusan K-1, 7 Okt 2026): hanya dokter `clinical.sign` yang berelasi dengan
 * pasien (DPJP, rawat bersama, dokter kunjungan, relasi akses, atau dokter jaga dengan akses darurat). Wajib jam
 * kematian dan sebab kematian ICD-10 dari data rujukan (trigger juga menolak kode yang tidak ada). Entri berversi
 * (ADR-0028); PDF ber-TTE dokter lewat `ClinicalSigningService.issueSigned` (kunci advisory versi), sehingga versi yang
 * ditandatangani terkunci (`RECORD_LOCKED`); koreksi hanya bila TTE-nya gagal. Satu rantai per kunjungan.
 * Syarat `DischargeGate` untuk disposisi `meninggal`.
 */
@Injectable()
export class DeathCertificateService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly signing: ClinicalSigningService,
    private readonly authority: DischargeAuthority,
  ) {}

  async get(encounterId: string): Promise<DeathCertificate> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const row = await this.current(enc.id);
    if (!row) throw new AppError('NOT_FOUND', 'Surat keterangan kematian belum dibuat', 404);
    this.db.audit({
      action: 'read',
      resourceType: 'death_certificate',
      resourceId: row.id,
      patientId: row.patientId,
    });
    return this.present(row);
  }

  async create(encounterId: string, input: DeathCertificateInput): Promise<DeathCertificate> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    if (!(await this.authority.mayCertifyDeath(enc.id, enc.patientId))) {
      throw new AppError(
        'FORBIDDEN',
        'Surat keterangan kematian hanya oleh dokter yang merawat pasien (DPJP, rawat bersama, atau dokter jaga yang punya akses)',
        403,
      );
    }
    const now = new Date();
    const diedAt = new Date(input.diedAt);
    if (occurredInFuture(diedAt, now)) {
      throw new AppError('VALIDATION_FAILED', 'Jam kematian tidak boleh di masa depan', 422, {
        fields: ['diedAt'],
      });
    }
    const tx = this.db.tx();
    const concept = await getConcept(tx, 'icd10', input.cause.code);
    if (!concept?.active) {
      throw new AppError('VALIDATION_FAILED', 'Sebab kematian harus kode ICD-10 dari data rujukan', 422, {
        fields: ['cause'],
      });
    }
    await lockClinicalKey(this.db, `death:${enc.id}`);
    if (input.revision.kind === 'baru' && (await this.current(enc.id))) {
      throw new AppError(
        'CONFLICT',
        'Surat keterangan kematian kunjungan ini sudah dibuat; bila TTE-nya gagal, buat koreksi beralasan',
        409,
      );
    }
    const fields = await this.records.prepare('death_certificates', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: now,
      revision: input.revision,
    });
    await this.records.insert(() =>
      tx.deathCertificate.create({
        data: {
          ...fields,
          encounterId: enc.id,
          diedAt,
          code: concept.code,
          display: concept.display,
          note: input.note?.trim() || null,
        },
      }),
    );
    const encRow = await tx.encounter.findUniqueOrThrow({
      where: { id: enc.id },
      select: { number: true, unit: { select: { name: true } } },
    });
    await this.signing.issueSigned('death_certificates', fields.id, {
      patientId: enc.patientId,
      kind: 'surat',
      title: 'Surat keterangan kematian',
      fileName: `surat kematian ${encRow.number}`,
      issuedAt: now,
      patientExtra: [
        { label: 'Kunjungan', value: encRow.number },
        { label: 'Unit', value: encRow.unit.name },
      ],
      sections: [
        {
          title: 'Keterangan kematian',
          blocks: [
            {
              kind: 'fields',
              rows: [
                { label: 'Waktu kematian', value: `${formatTanggalWaktu(diedAt)} WIB` },
                { label: 'Sebab kematian', value: `${concept.code} · ${concept.display}` },
                { label: 'Tempat', value: encRow.unit.name },
                ...(input.note?.trim() ? [{ label: 'Keterangan', value: input.note.trim() }] : []),
              ],
            },
          ],
        },
      ],
      tte: { role: 'Dokter yang menerangkan', caption: null },
    });
    this.db.audit({
      action: input.revision.kind === 'koreksi' ? 'correct' : 'create',
      resourceType: 'death_certificate',
      resourceId: fields.id,
      patientId: enc.patientId,
      reason: input.revision.kind === 'koreksi' ? input.revision.correctionReason : null,
      // Sebab kematian tidak disalin ke audit (data kesehatan; tersimpan di tabelnya).
      details: { encounterId: enc.id, version: fields.version },
    });
    return this.present(await tx.deathCertificate.findUniqueOrThrow({ where: { id: fields.id } }));
  }

  private current(encounterId: string): Promise<DeathRow | null> {
    return this.db.tx().deathCertificate.findFirst({
      where: { encounterId, addendumOf: null, status: 'final', supersededBy: { none: {} } },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async present(row: DeathRow): Promise<DeathCertificate> {
    const [names, doc, locked] = await Promise.all([
      this.records.userNames([row.authorUserId]),
      this.db.tx().document.findFirst({
        where: { sourceType: 'death_certificates', sourceId: row.id, voidedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          title: true,
          signatures: {
            orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { status: true },
          },
        },
      }),
      this.records.lockedIds('death_certificates', [row.id]),
    ]);
    const author: ClinicalAuthor = {
      userId: row.authorUserId,
      nama: names.get(row.authorUserId) ?? 'Dokter',
      peran: row.authorRole,
    };
    return {
      id: row.id,
      rootId: row.rootId,
      version: row.version,
      locked: locked.has(row.id),
      encounterId: row.encounterId,
      patientId: row.patientId,
      diedAt: row.diedAt.toISOString(),
      cause: { code: row.code, display: row.display.slice(0, 200) },
      note: row.note,
      author,
      recordedAt: row.recordedAt.toISOString(),
      document: doc
        ? {
            id: doc.id,
            title: doc.title,
            signatureStatus: (doc.signatures[0]?.status as SignatureStatus | undefined) ?? null,
          }
        : null,
    };
  }
}
