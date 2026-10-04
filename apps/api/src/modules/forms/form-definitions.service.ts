import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  AppError,
  type CreateFormDefinitionInput,
  type FormCategory,
  type FormDefinitionStatus,
  formReadyProblems,
  type FormSchema,
  formSchemaSchema,
  newId,
  type UpdateFormDraftInput,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { type DefinitionRow, FormsRepository } from './forms.repository';

export interface DefinitionView {
  id: string;
  code: string;
  version: number;
  title: string;
  category: FormCategory;
  status: FormDefinitionStatus;
  schema: FormSchema;
  writeRoles: string[];
  changeNote: string;
  createdAt: string;
  createdBy: string | null;
  /** Token konkurensi: dikirim balik sebagai `baseUpdatedAt` saat mengubah/memproses draf. */
  updatedAt: string;
  submittedAt: string | null;
  submittedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  archivedAt: string | null;
}

/**
 * P07 · Siklus definisi formulir: draf → diajukan ke komite RM → terbit (versi lama diarsipkan). Isi versi
 * terbit tidak bisa diubah (trigger database); perubahan = draf versi berikutnya. Setiap langkah diaudit.
 */
@Injectable()
export class FormDefinitionsService {
  constructor(
    private readonly db: TenantDb,
    private readonly repo: FormsRepository,
  ) {}

  async list() {
    const rows = await this.repo.allDefinitions();
    const byCode = new Map<string, typeof rows>();
    for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
    return [...byCode.entries()].map(([code, versions]) => {
      const published = versions.find((v) => v.status === 'published') ?? null;
      const draft = versions.find((v) => v.status === 'draft' || v.status === 'submitted') ?? null;
      const head = draft ?? published ?? versions[0];
      return {
        code,
        title: (published ?? head)?.title ?? code,
        category: (head?.category ?? 'umum') as FormCategory,
        published: published
          ? { version: published.version, publishedAt: published.publishedAt?.toISOString() ?? null }
          : null,
        draft: draft ? { version: draft.version, status: draft.status as FormDefinitionStatus } : null,
        versionCount: versions.length,
        updatedAt: (head?.updatedAt ?? new Date(0)).toISOString(),
      };
    });
  }

  async get(code: string) {
    const versions = await this.repo.versions(code);
    if (versions.length === 0) throw new AppError('NOT_FOUND', 'Formulir tidak ditemukan', 404);
    const names = await this.repo.userNames(
      versions.flatMap((v) => [v.createdBy, v.submittedBy, v.publishedBy]),
    );
    const view = (v: DefinitionRow | undefined) => (v ? this.present(v, names) : null);
    return {
      code,
      published: view(versions.find((v) => v.status === 'published')),
      draft: view(versions.find((v) => v.status === 'draft' || v.status === 'submitted')),
      history: versions.map((v) => ({
        version: v.version,
        status: v.status as FormDefinitionStatus,
        changeNote: v.changeNote,
        createdAt: v.createdAt.toISOString(),
        publishedAt: v.publishedAt?.toISOString() ?? null,
        publishedBy: v.publishedBy ? (names.get(v.publishedBy) ?? null) : null,
      })),
    };
  }

  async getVersion(code: string, version: number): Promise<DefinitionView> {
    const v = await this.repo.findVersion(code, version);
    if (!v) throw new AppError('NOT_FOUND', `Versi ${version} formulir ${code} tidak ditemukan`, 404);
    return this.present(v, await this.repo.userNames([v.createdBy, v.submittedBy, v.publishedBy]));
  }

  async create(input: CreateFormDefinitionInput): Promise<DefinitionView> {
    await this.repo.lockForm(input.code);
    if ((await this.repo.maxVersion(input.code)) > 0) {
      throw new AppError('CONFLICT', `Kode formulir ${input.code} sudah dipakai`, 409);
    }
    await this.assertRoles(input.writeRoles);
    const row = await this.repo.createDefinition({
      id: newId(),
      code: input.code,
      version: 1,
      title: input.title,
      category: input.category,
      status: 'draft',
      schema: input.schema as Prisma.InputJsonValue,
      writeRoles: input.writeRoles,
      changeNote: input.changeNote,
    });
    this.audit('create', row, { from: null });
    return this.present(row, new Map());
  }

  async updateDraft(code: string, input: UpdateFormDraftInput): Promise<DefinitionView> {
    await this.repo.lockForm(code);
    const { baseUpdatedAt, ...changes } = input;
    const draft = await this.editableDraft(code);
    this.assertBase(draft, baseUpdatedAt);
    if (changes.writeRoles) await this.assertRoles(changes.writeRoles);
    const row = await this.repo.updateDefinition(draft.id, {
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.schema !== undefined ? { schema: changes.schema as Prisma.InputJsonValue } : {}),
      ...(changes.writeRoles !== undefined ? { writeRoles: changes.writeRoles } : {}),
      ...(changes.changeNote !== undefined ? { changeNote: changes.changeNote } : {}),
    });
    const fields = Object.entries(changes)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)
      .sort();
    this.audit('update', row, { fields });
    return this.present(row, new Map());
  }

  /** Draf versi berikutnya, disalin dari versi yang berlaku. */
  async newDraft(code: string, changeNote: string): Promise<DefinitionView> {
    await this.repo.lockForm(code);
    if (await this.repo.openDraft(code)) {
      throw new AppError('CONFLICT', 'Masih ada draf yang belum terbit untuk formulir ini', 409);
    }
    const published = await this.repo.published(code);
    if (!published) throw new AppError('NOT_FOUND', 'Formulir belum punya versi berlaku', 404);
    const row = await this.repo.createDefinition({
      id: newId(),
      code,
      version: (await this.repo.maxVersion(code)) + 1,
      title: published.title,
      category: published.category,
      status: 'draft',
      schema: published.schema as Prisma.InputJsonValue,
      writeRoles: published.writeRoles,
      changeNote,
    });
    this.audit('create', row, { from: published.version });
    return this.present(row, new Map());
  }

  /** Ajukan ke komite RM: formulir harus lengkap (`formReadyProblems`). */
  async submit(code: string, baseUpdatedAt?: string): Promise<DefinitionView> {
    await this.repo.lockForm(code);
    const draft = await this.editableDraft(code);
    this.assertBase(draft, baseUpdatedAt);
    const problems = formReadyProblems(formSchemaSchema.parse(draft.schema));
    if (problems.length > 0) {
      throw new AppError('VALIDATION_FAILED', `Belum bisa diajukan: ${problems.join('; ')}`, 400, {
        problems,
      });
    }
    const row = await this.repo.updateDefinition(draft.id, {
      status: 'submitted',
      submittedAt: new Date(),
      submittedBy: this.db.actorUserId(),
    });
    this.audit('submit', row, {});
    return this.present(row, new Map());
  }

  /** Tarik kembali pengajuan untuk diperbaiki. */
  async withdraw(code: string, baseUpdatedAt?: string): Promise<DefinitionView> {
    await this.repo.lockForm(code);
    const draft = await this.repo.openDraft(code);
    if (draft?.status !== 'submitted')
      throw new AppError('CONFLICT', 'Tidak ada pengajuan yang bisa ditarik', 409);
    this.assertBase(draft, baseUpdatedAt);
    const row = await this.repo.updateDefinition(draft.id, {
      status: 'draft',
      submittedAt: null,
      submittedBy: null,
    });
    this.audit('update', row, { status: 'draft' });
    return this.present(row, new Map());
  }

  /** Terbitkan versi yang diajukan; versi berlaku sebelumnya diarsipkan (isian lama tetap memakainya). */
  async publish(code: string, baseUpdatedAt?: string): Promise<DefinitionView> {
    await this.repo.lockForm(code);
    const draft = await this.repo.openDraft(code);
    if (draft?.status !== 'submitted') {
      throw new AppError('CONFLICT', 'Ajukan draf ke komite sebelum diterbitkan', 409);
    }
    // Yang diterbitkan harus persis versi yang dilihat penerbit (bukan hasil tarik-ubah-ajukan orang lain).
    this.assertBase(draft, baseUpdatedAt);
    const previous = await this.repo.published(code);
    const now = new Date();
    if (previous) await this.repo.updateDefinition(previous.id, { status: 'archived', archivedAt: now });
    const row = await this.repo.updateDefinition(draft.id, {
      status: 'published',
      publishedAt: now,
      publishedBy: this.db.actorUserId(),
    });
    this.audit('publish', row, { archived: previous?.version ?? null });
    return this.present(row, new Map());
  }

  private async editableDraft(code: string): Promise<DefinitionRow> {
    const draft = await this.repo.openDraft(code);
    if (!draft) throw new AppError('NOT_FOUND', 'Tidak ada draf untuk formulir ini', 404);
    if (draft.status !== 'draft') {
      throw new AppError('CONFLICT', 'Draf sudah diajukan; tarik kembali pengajuan untuk mengubahnya', 409);
    }
    return draft;
  }

  private assertBase(row: DefinitionRow, baseUpdatedAt: string | undefined): void {
    if (baseUpdatedAt !== undefined && row.updatedAt.toISOString() !== baseUpdatedAt) {
      throw new AppError(
        'CONFLICT',
        'Draf sudah diubah pengguna lain sejak Anda membukanya. Muat ulang untuk melihat versi terbaru.',
        409,
      );
    }
  }

  private async assertRoles(codes: string[]): Promise<void> {
    const known = await this.repo.roleCodes(codes);
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_FAILED', `Peran tidak dikenal: ${unknown.join(', ')}`, 400);
    }
  }

  private audit(action: 'create' | 'update' | 'submit' | 'publish', row: DefinitionRow, extra: object) {
    this.db.audit({
      action,
      resourceType: 'form_definition',
      resourceId: row.id,
      details: { code: row.code, version: row.version, ...extra },
    });
  }

  private present(v: DefinitionRow, names: Map<string, string>): DefinitionView {
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      id: v.id,
      code: v.code,
      version: v.version,
      title: v.title,
      category: v.category as FormCategory,
      status: v.status as FormDefinitionStatus,
      schema: v.schema as FormSchema,
      writeRoles: v.writeRoles,
      changeNote: v.changeNote,
      createdAt: v.createdAt.toISOString(),
      createdBy: name(v.createdBy),
      updatedAt: v.updatedAt.toISOString(),
      submittedAt: v.submittedAt?.toISOString() ?? null,
      submittedBy: name(v.submittedBy),
      publishedAt: v.publishedAt?.toISOString() ?? null,
      publishedBy: name(v.publishedBy),
      archivedAt: v.archivedAt?.toISOString() ?? null,
    };
  }
}
