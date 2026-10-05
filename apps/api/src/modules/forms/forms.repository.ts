import { Injectable } from '@nestjs/common';
import { lockTenantScope, type Prisma } from '@simrs/db';
import { TenantDb } from '../../infra/tenant-db';

export const DEFINITION_SELECT = {
  id: true,
  code: true,
  version: true,
  title: true,
  category: true,
  status: true,
  schema: true,
  writeRoles: true,
  changeNote: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  submittedAt: true,
  submittedBy: true,
  publishedAt: true,
  publishedBy: true,
  archivedAt: true,
} as const;
export type DefinitionRow = Prisma.FormDefinitionGetPayload<{ select: typeof DEFINITION_SELECT }>;

export const RESPONSE_SELECT = {
  id: true,
  patientId: true,
  definitionId: true,
  formCode: true,
  version: true,
  rootId: true,
  supersedesId: true,
  status: true,
  answers: true,
  score: true,
  scoreBand: true,
  correctionReason: true,
  createdAt: true,
  createdBy: true,
  encounterId: true,
  definition: { select: { version: true, title: true, schema: true, writeRoles: true } },
} as const;
export type ResponseRow = Prisma.FormResponseGetPayload<{ select: typeof RESPONSE_SELECT }>;

/** P07 · Akses data formulir (transaksi permintaan, RLS aktif). */
@Injectable()
export class FormsRepository {
  constructor(private readonly db: TenantDb) {}

  /** Siklus satu formulir (buat draf, ajukan, terbitkan) berjalan berurutan. */
  lockForm(code: string): Promise<void> {
    return lockTenantScope(this.db.tx(), `form:${code}`);
  }

  allDefinitions() {
    return this.db.tx().formDefinition.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        code: true,
        version: true,
        title: true,
        category: true,
        status: true,
        updatedAt: true,
        publishedAt: true,
      },
    });
  }

  versions(code: string): Promise<DefinitionRow[]> {
    return this.db.tx().formDefinition.findMany({
      where: { code },
      orderBy: { version: 'desc' },
      select: DEFINITION_SELECT,
    });
  }

  findVersion(code: string, version: number): Promise<DefinitionRow | null> {
    return this.db.tx().formDefinition.findFirst({ where: { code, version }, select: DEFINITION_SELECT });
  }

  published(code: string): Promise<DefinitionRow | null> {
    return this.db.tx().formDefinition.findFirst({
      where: { code, status: 'published' },
      select: DEFINITION_SELECT,
    });
  }

  openDraft(code: string): Promise<DefinitionRow | null> {
    return this.db.tx().formDefinition.findFirst({
      where: { code, status: { in: ['draft', 'submitted'] } },
      select: DEFINITION_SELECT,
    });
  }

  async maxVersion(code: string): Promise<number> {
    const r = await this.db.tx().formDefinition.aggregate({ where: { code }, _max: { version: true } });
    return r._max.version ?? 0;
  }

  /** Kode peran yang ada di RS ini (validasi hak tulis per profesi). */
  async roleCodes(codes: string[]): Promise<Set<string>> {
    const rows = await this.db.tx().role.findMany({ where: { code: { in: codes } }, select: { code: true } });
    return new Set(rows.map((r) => r.code));
  }

  createDefinition(data: Omit<Prisma.FormDefinitionUncheckedCreateInput, 'tenantId'>) {
    return this.db.tx().formDefinition.create({
      data: {
        ...data,
        tenantId: this.db.tenantId(),
        createdBy: this.db.actorUserId(),
        updatedBy: this.db.actorUserId(),
      },
      select: DEFINITION_SELECT,
    });
  }

  updateDefinition(id: string, data: Prisma.FormDefinitionUncheckedUpdateInput) {
    return this.db.tx().formDefinition.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: DEFINITION_SELECT,
    });
  }

  // ---------- isian ----------
  createResponse(data: Omit<Prisma.FormResponseUncheckedCreateInput, 'tenantId' | 'createdBy'>) {
    return this.db.tx().formResponse.create({
      data: { ...data, tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() },
      select: RESPONSE_SELECT,
    });
  }

  findResponse(id: string): Promise<ResponseRow | null> {
    return this.db.tx().formResponse.findUnique({ where: { id }, select: RESPONSE_SELECT });
  }

  /** Semua versi satu isian, urut naik. */
  chain(rootId: string): Promise<ResponseRow[]> {
    return this.db.tx().formResponse.findMany({
      where: { rootId },
      orderBy: { version: 'asc' },
      select: RESPONSE_SELECT,
    });
  }

  async hasNewerVersion(id: string): Promise<boolean> {
    return (await this.db.tx().formResponse.count({ where: { supersedesId: id } })) > 0;
  }

  /** Rekam medis yang digabung = satu orang (ADR-0016): semua id rekam medis dalam kelompok pasien ini. */
  async patientGroup(patientId: string): Promise<string[]> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT app_patient_group(${patientId}::uuid)::text AS id`;
    return rows.length > 0 ? rows.map((r) => r.id) : [patientId];
  }

  /** Versi terbaru tiap isian (yang belum digantikan versi lain) milik rekam medis-rekam medis ini. */
  current(patientIds: string[], formCode?: string): Promise<ResponseRow[]> {
    return this.db.tx().formResponse.findMany({
      where: {
        patientId: { in: patientIds },
        ...(formCode ? { formCode } : {}),
        supersededBy: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      select: RESPONSE_SELECT,
    });
  }

  findPatient(id: string) {
    return this.db.tx().patient.findUnique({
      where: { id },
      select: { id: true, status: true, mergedInto: { select: { mrn: true } } },
    });
  }

  async userNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (wanted.length === 0) return new Map();
    const users = await this.db.tx().user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }
}
