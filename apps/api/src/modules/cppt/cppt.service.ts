import { Injectable } from '@nestjs/common';
import { knownDbError, type Prisma } from '@simrs/db';
import {
  AppError,
  type ClinicalAttestation,
  type ClinicalAttestationInput,
  type ClinicalEntryMeta,
  clinicalError,
  type CpptContent,
  type CpptCreateInput,
  type CpptRecord,
  type CpptRole,
  findForbiddenAbbreviations,
  type ForbiddenAbbreviation,
  type HandoverInput,
  type HandoverRecord,
  newId,
} from '@simrs/shared';
import { assertRevisionAllowed, clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService, type ClinicalRowLike } from '../../infra/clinical/clinical-record.service';
import { BillableRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { PermissionMatrix } from '../../infra/permission-matrix';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Peran penugasan → PPA penulis CPPT. Peran lain (termasuk peran buatan RS) tidak menulis CPPT. */
export const PPA_OF_ROLE: Readonly<Record<string, CpptRole>> = {
  dokter: 'dpjp',
  dokter_residen: 'residen',
  perawat: 'perawat',
  bidan: 'bidan',
  apoteker: 'farmasi',
  ahli_gizi: 'gizi',
};

/** Peran tim perawatan yang boleh co-sign/verifikasi (DPJP utama dan rawat bersama, rencana §3.2b). */
const ATTESTING_TEAM_ROLES = ['dpjp_utama', 'rawat_bersama'];

const CURRENT = { supersededBy: { none: {} } } as const;

type CpptRow = ClinicalRowLike & {
  patientId: string;
  encounterId: string;
  ppa: string;
  format: string;
  content: Prisma.JsonValue;
  instruction: string | null;
  cosignRequired: boolean;
};

type HandoverRow = ClinicalRowLike & {
  patientId: string;
  encounterId: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  toUserId: string | null;
};

/** Teks bebas CPPT yang diperiksa singkatan terlarang. */
function cpptText(content: CpptContent, instruction: string | null): string {
  const parts =
    content.format === 'soap'
      ? [content.s, content.o, content.a, content.p]
      : [content.assessment, content.diagnosis, content.intervention, content.monitoring, content.evaluation];
  return [...parts, instruction ?? ''].join('\n');
}

/**
 * K07 · CPPT terintegrasi multi-PPA (rencana fase 3 §3.2b, keputusan no. 2/4/5/16):
 * - PPA dan penulis dari SESI (`PPA_OF_ROLE`), bukan body; catatan residen `cosign_required` → `menunggu_cosign`
 *   sampai DPJP/rawat bersama co-sign (atestasi `cosign`, satu per entri; serentak → 409);
 * - co-sign bukan atas catatan sendiri; residen tidak punya izin `clinical.cosign` (403 di guard);
 * - verifikasi DPJP atas CPPT PPA lain (`verify`) tidak memblokir; yang lewat `cppt.verify_hours` muncul di worklist;
 * - koreksi (penulis asli, izin `clinical.correct`), addendum PPA lain, salah entri lewat `ClinicalRecordService`;
 * - singkatan terlarang RS = PERINGATAN di jawaban, tidak memblokir (EP 9a);
 * - CPPT DPJP versi 1 = peristiwa biaya `visite` (ADR-0032); event `cppt.finalized`.
 * Serah terima SBAR berversi; penerima mendapat notifikasi tanpa PHI.
 */
@Injectable()
export class CpptService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly matrix: PermissionMatrix,
    private readonly billable: BillableRecorder,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationsService,
  ) {}

  async create(input: CpptCreateInput): Promise<CpptRecord> {
    await assertRevisionAllowed(this.db, this.matrix, input.revision);
    const ppa = this.ppa();
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const tx = this.db.tx();
    const f = await this.records.prepare('cppt_entries', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: input.revision,
    });
    const cosignRequired = ppa === 'residen';
    await this.records.insert(() =>
      tx.cpptEntry.create({
        data: {
          ...f,
          encounterId: enc.id,
          ppa,
          format: input.content.format,
          content: input.content as Prisma.InputJsonValue,
          instruction: input.instruction,
          cosignRequired,
        },
      }),
    );
    if (ppa === 'dpjp' && f.version === 1 && !f.addendumOf) {
      await this.billable.record({
        encounterId: enc.id,
        patientId: enc.patientId,
        sourceType: 'cppt_entries',
        sourceId: f.rootId,
        kind: 'visite',
        occurredAt: f.occurredAt,
      });
    }
    await this.events.publish('cppt.finalized', {
      cpptId: f.id,
      encounterId: enc.id,
      patientId: enc.patientId,
      cosignRequired,
    });
    this.db.audit({
      action: f.supersedesId ? 'correct' : 'create',
      resourceType: 'cppt_entry',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { version: f.version, ppa, addendumOf: f.addendumOf, cosignRequired },
    });
    const row = await tx.cpptEntry.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.present([row]))[0] as CpptRecord;
  }

  async list(encounterId: string): Promise<CpptRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().cpptEntry.findMany({
      where: { encounterId: enc.id, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    this.db.audit({
      action: 'read',
      resourceType: 'cppt_entry',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return this.present(rows);
  }

  async enteredInError(id: string, reason: string): Promise<ClinicalEntryMeta> {
    const target = await this.db.tx().cpptEntry.findUnique({ where: { id }, select: { patientId: true } });
    if (!target) throw new AppError('NOT_FOUND', 'Catatan CPPT tidak ditemukan', 404);
    await this.access.assert(target.patientId);
    const done = await this.records.enteredInError('cppt_entries', id, reason);
    const row = await this.db.tx().cpptEntry.findUniqueOrThrow({ where: { id: done.id } });
    const meta = (await this.records.meta('cppt_entries', [row])).get(row.id) as ClinicalEntryMeta;
    this.db.audit({
      action: 'correct',
      resourceType: 'cppt_entry',
      resourceId: row.id,
      patientId: row.patientId,
      reason,
      details: { version: row.version, status: 'entered_in_error', supersedesId: id },
    });
    return meta;
  }

  /** Co-sign DPJP/rawat bersama atas CPPT residen (versi final terkini, bukan catatan sendiri). */
  async cosign(id: string, input: ClinicalAttestationInput): Promise<CpptRecord> {
    const row = await this.attestable(id, 'cosign');
    if (!row.cosignRequired) {
      throw new AppError('CONFLICT', 'Catatan ini tidak memerlukan co-sign', 409);
    }
    await this.attest(row, 'cosign', input.note);
    return (await this.present([row]))[0] as CpptRecord;
  }

  /** Verifikasi DPJP atas CPPT PPA lain (keputusan fase 3 no. 5): tidak memblokir, menutup tugas worklist. */
  async verify(id: string, input: ClinicalAttestationInput): Promise<CpptRecord> {
    const row = await this.attestable(id, 'verify');
    if (row.cosignRequired) {
      throw new AppError('CONFLICT', 'Catatan residen ditinjau lewat co-sign, bukan verifikasi', 409);
    }
    if (row.ppa === 'dpjp') {
      throw new AppError('CONFLICT', 'Catatan DPJP tidak memerlukan verifikasi DPJP', 409);
    }
    await this.attest(row, 'verify', input.note);
    return (await this.present([row]))[0] as CpptRecord;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Serah terima SBAR
  // ------------------------------------------------------------------------------------------------------------

  async handover(input: HandoverInput): Promise<HandoverRecord> {
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const tx = this.db.tx();
    if (input.toUserId) {
      const to = await tx.user.findUnique({ where: { id: input.toUserId }, select: { status: true } });
      if (to?.status !== 'active')
        throw new AppError('VALIDATION_FAILED', 'Penerima serah terima tidak aktif', 422);
    }
    const f = await this.records.prepare('handovers', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.occurredAt,
      revision: { kind: 'baru' },
    });
    await this.records.insert(() =>
      tx.handover.create({
        data: {
          ...f,
          encounterId: enc.id,
          situation: input.situation,
          background: input.background,
          assessment: input.assessment,
          recommendation: input.recommendation,
          toUserId: input.toUserId,
        },
      }),
    );
    this.db.audit({
      action: 'create',
      resourceType: 'handover',
      resourceId: f.id,
      patientId: enc.patientId,
      details: { toUserId: input.toUserId },
    });
    if (input.toUserId && input.toUserId !== f.authorUserId) {
      const unit = await tx.unit.findUnique({ where: { id: enc.unitId }, select: { name: true } });
      await this.notifications.notify([input.toUserId], {
        kind: 'handover',
        title: 'Serah terima pasien untuk Anda',
        body: `Ada serah terima pasien di ${unit?.name ?? 'unit'}. Buka tautan untuk membaca SBAR.`,
        link: `/klinis/rawat-inap?kunjungan=${enc.id}`,
      });
    }
    const row = await tx.handover.findUniqueOrThrow({ where: { id: f.id } });
    return (await this.presentHandovers([row]))[0] as HandoverRecord;
  }

  async handovers(encounterId: string): Promise<HandoverRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().handover.findMany({
      where: { encounterId: enc.id, status: 'final', ...CURRENT },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    this.db.audit({
      action: 'read',
      resourceType: 'handover',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return this.presentHandovers(rows);
  }

  // ------------------------------------------------------------------------------------------------------------

  private ppa(): CpptRole {
    const { role } = this.records.author();
    const ppa = PPA_OF_ROLE[role];
    if (!ppa) throw new AppError('FORBIDDEN', 'Peran Anda bukan PPA penulis CPPT', 403);
    return ppa;
  }

  /**
   * Target atestasi: versi final terkini (kunci versi sama dengan koreksi), pasien terbuka (ABAC), bukan catatan
   * sendiri, dan pelaku DPJP utama/rawat bersama kunjungan itu (atau DPJP kunjungan).
   */
  private async attestable(id: string, kind: 'cosign' | 'verify'): Promise<CpptRow> {
    const { userId } = this.records.author();
    await this.records.lockVersion('cppt_entries', id);
    const tx = this.db.tx();
    const row = await tx.cpptEntry.findUnique({
      where: { id },
      include: { supersededBy: { select: { id: true }, take: 1 } },
    });
    if (!row) throw new AppError('NOT_FOUND', 'Catatan CPPT tidak ditemukan', 404);
    await this.access.assert(row.patientId);
    if (row.supersededBy.length > 0) throw clinicalError('RECORD_SUPERSEDED');
    if (row.status !== 'final') throw clinicalError('RECORD_NOT_FINAL');
    if (row.authorUserId === userId) {
      throw clinicalError(
        'COSIGN_NOT_ALLOWED',
        { kind },
        kind === 'cosign' ? undefined : 'Verifikasi bukan atas catatan sendiri',
      );
    }
    const [member, enc] = await Promise.all([
      tx.encounterParticipant.findFirst({
        where: { encounterId: row.encounterId, userId, endedAt: null, role: { in: ATTESTING_TEAM_ROLES } },
        select: { id: true },
      }),
      tx.encounter.findUniqueOrThrow({
        where: { id: row.encounterId },
        select: { practitioner: { select: { userId: true } } },
      }),
    ]);
    if (!member && enc.practitioner?.userId !== userId) {
      throw clinicalError('COSIGN_NOT_ALLOWED', { kind });
    }
    const { supersededBy: _ignored, ...rest } = row;
    return rest;
  }

  private async attest(row: CpptRow, kind: 'cosign' | 'verify', note: string | null): Promise<void> {
    const { userId, role } = this.records.author();
    try {
      await this.db.tx().clinicalAttestation.create({
        data: {
          id: newId(),
          tenantId: this.db.tenantId(),
          patientId: row.patientId,
          encounterId: row.encounterId,
          targetType: 'cppt_entries',
          targetId: row.id,
          kind,
          userId,
          userRole: role,
          note,
        },
      });
    } catch (err) {
      if (knownDbError(err)?.code === 'P2002') {
        throw new AppError(
          'CONFLICT',
          kind === 'cosign' ? 'Catatan ini sudah di-co-sign' : 'Anda sudah memverifikasi catatan ini',
          409,
        );
      }
      throw err;
    }
    this.db.audit({
      action: kind === 'cosign' ? 'cosign' : 'verify',
      resourceType: 'cppt_entry',
      resourceId: row.id,
      patientId: row.patientId,
      details: { kind },
    });
  }

  private async abbreviations(): Promise<ForbiddenAbbreviation[]> {
    const rows = await this.db.tx().abbreviation.findMany({
      where: { active: true },
      select: { kind: true, term: true, suggestion: true },
    });
    return rows.map((r) => ({
      kind: r.kind as ForbiddenAbbreviation['kind'],
      term: r.term,
      suggestion: r.suggestion,
    }));
  }

  async present(rows: CpptRow[]): Promise<CpptRecord[]> {
    if (rows.length === 0) return [];
    const [meta, list, attestations] = await Promise.all([
      this.records.meta('cppt_entries', rows),
      this.abbreviations(),
      this.db.tx().clinicalAttestation.findMany({
        where: {
          targetType: 'cppt_entries',
          targetId: { in: rows.map((r) => r.id) },
          kind: { in: ['cosign', 'verify'] },
        },
        orderBy: { attestedAt: 'asc' },
      }),
    ]);
    const names = await this.records.userNames(attestations.map((a) => a.userId));
    const attestation = (targetId: string, kind: string): ClinicalAttestation | null => {
      const a = attestations.find((x) => x.targetId === targetId && x.kind === kind);
      return a
        ? {
            kind: a.kind as ClinicalAttestation['kind'],
            by: { userId: a.userId, nama: names.get(a.userId) ?? 'Pengguna', peran: a.userRole },
            at: a.attestedAt.toISOString(),
          }
        : null;
    };
    return rows.map((r) => {
      const content = r.content as CpptContent;
      const cosign = attestation(r.id, 'cosign');
      const m = meta.get(r.id) as ClinicalEntryMeta;
      const warnings = findForbiddenAbbreviations(cpptText(content, r.instruction), list);
      return {
        ...m,
        encounterId: r.encounterId,
        patientId: r.patientId,
        ppa: r.ppa as CpptRole,
        content,
        instruction: r.instruction,
        status:
          m.status === 'entered_in_error'
            ? 'entered_in_error'
            : r.cosignRequired && !cosign
              ? 'menunggu_cosign'
              : 'final',
        cosignRequired: r.cosignRequired,
        cosign,
        verification: attestation(r.id, 'verify'),
        abbreviationWarnings: [...new Set(warnings.map((w) => `${w.found}: ${w.suggestion}`))],
      };
    });
  }

  private async presentHandovers(rows: HandoverRow[]): Promise<HandoverRecord[]> {
    const meta = await this.records.meta('handovers', rows);
    const names = await this.records.userNames(rows.flatMap((r) => (r.toUserId ? [r.toUserId] : [])));
    return rows.map((r) => ({
      ...(meta.get(r.id) as ClinicalEntryMeta),
      patientId: r.patientId,
      encounterId: r.encounterId,
      situation: r.situation,
      background: r.background,
      assessment: r.assessment,
      recommendation: r.recommendation,
      toUser: r.toUserId ? { userId: r.toUserId, nama: names.get(r.toUserId) ?? 'Pengguna' } : null,
    }));
  }
}
