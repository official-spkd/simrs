import { Injectable } from '@nestjs/common';
import { knownDbError, type Prisma } from '@simrs/db';
import {
  AppError,
  type CorrectFormResponseInput,
  diffAnswers,
  type FormAnswers,
  type FormDiffRow,
  type FormResponseStatus,
  type FormSchema,
  formSchemaSchema,
  newId,
  scoreForm,
  validateAnswers,
} from '@simrs/shared';
import { AuditedDenial } from '../../common/audited-denial';
import { DEV_ROLE } from '../../common/request-context';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { FormsRepository, type ResponseRow } from './forms.repository';

export interface ResponseVersionView {
  id: string;
  version: number;
  status: FormResponseStatus;
  answers: FormAnswers;
  score: number | null;
  scoreBand: string | null;
  correctionReason: string | null;
  createdAt: string;
  author: string | null;
  /** Perubahan dibanding versi sebelumnya (kosong untuk versi 1). */
  changes: FormDiffRow[];
}

/**
 * P07 · Isian formulir pasien. Append-only (ADR-0004): isian final tidak pernah diubah; koreksi = versi baru
 * beralasan yang menggantikan versi terakhir, divalidasi terhadap versi formulir yang SAMA dengan isian asli
 * (MRMIK 6c). Hak tulis per profesi (`write_roles`, MRMIK 10a) + ABAC relasi pasien (P03).
 */
@Injectable()
export class FormResponsesService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: FormsRepository,
    private readonly access: PatientAccessService,
  ) {}

  private async assertAccess(patientId: string): Promise<void> {
    if (this.db.permissionScope() !== 'all') await this.access.assert(patientId);
  }

  /** Hak tulis per profesi: peran aktif harus tercantum di definisi formulir. Penolakan diaudit. */
  private assertWriteRole(writeRoles: string[], patientId: string, code: string): void {
    const role = this.db.actor().role;
    if (role === DEV_ROLE || (role && writeRoles.includes(role))) return;
    throw new AuditedDenial('Peran Anda tidak berhak mengisi formulir ini (hak tulis per profesi)', {
      resourceType: 'form_response',
      patientId,
      details: { form: code, role },
    });
  }

  private schemaOf(row: { schema: Prisma.JsonValue }): FormSchema {
    return formSchemaSchema.parse(row.schema);
  }

  private validated(schema: FormSchema, answers: FormAnswers) {
    const errors = validateAnswers(schema, answers);
    if (Object.keys(errors).length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Isian belum lengkap atau tidak valid', 400, {
        fields: errors,
      });
    }
    return scoreForm(schema, answers);
  }

  async create(patientId: string, code: string, answers: FormAnswers, encounterId: string | null = null) {
    await this.assertAccess(patientId);
    return this.insert(patientId, code, answers, encounterId, true);
  }

  /**
   * Isian yang otorisasinya sudah ditegakkan modul pemanggil, mis. catatan anestesi oleh penata anestesi yang tercatat
   * di tim kasus operasi (ADR-0106 pembaruan 4.7c): akses pasien dan hak tulis per profesi TIDAK diperiksa ulang di
   * sini. Pasien, kunjungan, versi formulir berlaku, dan validasi isian tetap sama dengan `create`. Koreksi/salah entri
   * tetap lewat jalur biasa (hak tulis per profesi).
   */
  async createAuthorized(patientId: string, code: string, answers: FormAnswers, encounterId: string) {
    return this.insert(patientId, code, answers, encounterId, false);
  }

  private async insert(
    patientId: string,
    code: string,
    answers: FormAnswers,
    encounterId: string | null,
    checkWriteRole: boolean,
  ) {
    const patient = await this.repo.findPatient(patientId);
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (patient.status === 'merged') {
      throw new AppError(
        'CONFLICT',
        `Rekam medis ini sudah digabung ke RM ${patient.mergedInto?.mrn ?? '-'}; isi formulir di rekam medis tersebut`,
        409,
      );
    }
    if (encounterId) await this.assertEncounter(encounterId, patientId);
    const def = await this.repo.published(code);
    if (!def) throw new AppError('NOT_FOUND', 'Formulir belum punya versi berlaku', 404);
    if (checkWriteRole) this.assertWriteRole(def.writeRoles, patientId, code);
    const score = this.validated(this.schemaOf(def), answers);
    const id = newId();
    const row = await this.repo.createResponse({
      id,
      rootId: id,
      patientId,
      definitionId: def.id,
      formCode: code,
      version: 1,
      status: 'final',
      answers: answers as Prisma.InputJsonValue,
      score: score.scored > 0 ? score.total : null,
      scoreBand: score.band?.label ?? null,
      encounterId,
    });
    return this.present([row], await this.names([row]));
  }

  /** Isian terkini pasien, termasuk dari rekam medis lama yang sudah digabung ke/dari pasien ini. */
  async listForPatient(patientId: string, code?: string) {
    await this.assertAccess(patientId);
    const rows = await this.repo.current(await this.repo.patientGroup(patientId), code);
    const names = await this.names(rows);
    return rows.map((r) => ({
      id: r.id,
      rootId: r.rootId,
      /** Rekam medis asal isian (bisa rekam medis lama dalam kelompok gabungan). */
      patientId: r.patientId,
      formCode: r.formCode,
      formTitle: r.definition.title,
      formVersion: r.definition.version,
      version: r.version,
      status: r.status as FormResponseStatus,
      score: r.score,
      scoreBand: r.scoreBand,
      createdAt: r.createdAt.toISOString(),
      author: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    }));
  }

  /** Semua versi satu isian beserta perubahannya (diff antarversi). */
  async get(id: string) {
    const row = await this.load(id);
    await this.assertAccess(row.patientId);
    const chain = await this.repo.chain(row.rootId);
    return this.present(chain, await this.names(chain));
  }

  async correct(id: string, input: CorrectFormResponseInput) {
    return this.newVersion(id, input.answers, input.reason, 'final');
  }

  /** Tandai salah entri (entered-in-error): versi baru berstatus khusus, isi tetap terbaca. */
  async void(id: string, reason: string) {
    const row = await this.load(id);
    return this.newVersion(id, row.answers as FormAnswers, reason, 'entered_in_error');
  }

  private async newVersion(id: string, answers: FormAnswers, reason: string, status: FormResponseStatus) {
    const prev = await this.load(id);
    await this.assertAccess(prev.patientId);
    if (await this.repo.hasNewerVersion(prev.id)) {
      throw new AppError('CONFLICT', 'Sudah ada versi yang lebih baru; muat ulang sebelum mengoreksi', 409);
    }
    if (prev.status === 'entered_in_error') {
      throw new AppError('CONFLICT', 'Isian ini sudah ditandai salah entri', 409);
    }
    this.assertWriteRole(prev.definition.writeRoles, prev.patientId, prev.formCode);
    const schema = this.schemaOf(prev.definition);
    const score = this.validated(schema, answers);
    const changes = diffAnswers(schema, prev.answers as FormAnswers, answers);
    if (status === 'final' && changes.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Tidak ada perubahan dibanding versi sebelumnya', 400);
    }
    let row: ResponseRow;
    try {
      row = await this.repo.createResponse({
        id: newId(),
        rootId: prev.rootId,
        supersedesId: prev.id,
        patientId: prev.patientId,
        definitionId: prev.definitionId,
        formCode: prev.formCode,
        version: prev.version + 1,
        status,
        answers: answers as Prisma.InputJsonValue,
        score: score.scored > 0 ? score.total : null,
        scoreBand: score.band?.label ?? null,
        correctionReason: reason,
        encounterId: prev.encounterId,
      });
    } catch (err) {
      // Dua koreksi serentak atas versi yang sama: indeks unik `supersedes_once` menolak yang kedua.
      if (knownDbError(err)?.code === 'P2002') {
        throw new AppError('CONFLICT', 'Isian ini baru saja dikoreksi petugas lain; muat ulang', 409);
      }
      throw err;
    }
    this.db.audit({
      action: 'correct',
      resourceType: 'form_response',
      resourceId: row.id,
      patientId: row.patientId,
      reason,
      details: {
        form: row.formCode,
        from: prev.version,
        to: row.version,
        status,
        fields: changes.map((c) => c.key),
      },
    });
    const chain = await this.repo.chain(prev.rootId);
    return this.present(chain, await this.names(chain));
  }

  /** K06 · Asesmen kunjungan: kunjungan milik pasien yang sama dan tidak batal. */
  private async assertEncounter(encounterId: string, patientId: string): Promise<void> {
    const enc = await this.db.tx().encounter.findUnique({
      where: { id: encounterId },
      select: { patientId: true, status: true },
    });
    if (!enc || enc.patientId !== patientId) {
      throw new AppError('VALIDATION_FAILED', 'Kunjungan bukan milik pasien ini', 422, {
        fields: ['encounterId'],
      });
    }
    if (enc.status === 'cancelled') {
      throw new AppError('CONFLICT', 'Kunjungan sudah dibatalkan; asesmen tidak bisa ditambahkan', 409);
    }
  }

  private async load(id: string): Promise<ResponseRow> {
    const row = await this.repo.findResponse(id);
    if (!row) throw new AppError('NOT_FOUND', 'Isian formulir tidak ditemukan', 404);
    return row;
  }

  private names(rows: ResponseRow[]) {
    return this.repo.userNames(rows.map((r) => r.createdBy));
  }

  private present(chain: ResponseRow[], names: Map<string, string>) {
    const first = chain[0] as ResponseRow;
    const latest = chain.at(-1) as ResponseRow;
    const schema = this.schemaOf(latest.definition);
    const versions: ResponseVersionView[] = chain.map((r, i) => ({
      id: r.id,
      version: r.version,
      status: r.status as FormResponseStatus,
      answers: r.answers as FormAnswers,
      score: r.score,
      scoreBand: r.scoreBand,
      correctionReason: r.correctionReason,
      createdAt: r.createdAt.toISOString(),
      author: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      changes:
        i === 0 ? [] : diffAnswers(schema, chain[i - 1]?.answers as FormAnswers, r.answers as FormAnswers),
    }));
    return {
      id: latest.id,
      rootId: first.id,
      patientId: latest.patientId,
      encounterId: latest.encounterId,
      formCode: latest.formCode,
      formTitle: latest.definition.title,
      formVersion: latest.definition.version,
      schema,
      current: versions.at(-1) as ResponseVersionView,
      versions,
    };
  }
}
