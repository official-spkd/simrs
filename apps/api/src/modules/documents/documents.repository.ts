import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import { TenantDb } from '../../infra/tenant-db';

export const DOCUMENT_SELECT = {
  id: true,
  patientId: true,
  kind: true,
  title: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  storageKey: true,
  createdAt: true,
  createdBy: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  signatures: {
    orderBy: { requestedAt: 'asc' },
    select: {
      id: true,
      signerUserId: true,
      status: true,
      verifyCode: true,
      requestedAt: true,
      signedAt: true,
      certificate: true,
    },
  },
} as const satisfies Prisma.DocumentSelect;
export type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

/** P08 · Akses data dokumen (transaksi permintaan, RLS aktif). */
@Injectable()
export class DocumentsRepository {
  constructor(private readonly db: TenantDb) {}

  findPatient(id: string) {
    return this.db.tx().patient.findUnique({
      where: { id },
      select: { id: true, status: true, mergedInto: { select: { mrn: true } } },
    });
  }

  /** Rekam medis yang digabung = satu orang (ADR-0016). */
  async patientGroup(patientId: string): Promise<string[]> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT app_patient_group(${patientId}::uuid)::text AS id`;
    return rows.length > 0 ? rows.map((r) => r.id) : [patientId];
  }

  create(data: Omit<Prisma.DocumentUncheckedCreateInput, 'tenantId' | 'createdBy'>): Promise<DocumentRow> {
    return this.db.tx().document.create({
      data: { ...data, tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() },
      select: DOCUMENT_SELECT,
    });
  }

  find(id: string): Promise<DocumentRow | null> {
    return this.db.tx().document.findUnique({ where: { id }, select: DOCUMENT_SELECT });
  }

  /** Kunci baris dokumen untuk pembatalan / permintaan tanda tangan (berurutan per dokumen). */
  async lock(id: string): Promise<void> {
    await this.db.tx().$queryRaw`SELECT 1 FROM documents WHERE id = ${id}::uuid FOR UPDATE`;
  }

  listForPatients(patientIds: string[]): Promise<DocumentRow[]> {
    return this.db.tx().document.findMany({
      where: { patientId: { in: patientIds } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: DOCUMENT_SELECT,
    });
  }

  void(id: string, reason: string): Promise<DocumentRow> {
    return this.db.tx().document.update({
      where: { id },
      data: { voidedAt: new Date(), voidedBy: this.db.actorUserId(), voidReason: reason },
      select: DOCUMENT_SELECT,
    });
  }

  createSignature(data: { id: string; documentId: string; documentSha256: string; verifyCode: string }) {
    const signerUserId = this.db.actorUserId();
    if (!signerUserId) throw new Error('Penanda tangan wajib pengguna yang login');
    return this.db.tx().documentSignature.create({
      data: { ...data, tenantId: this.db.tenantId(), signerUserId },
      select: { id: true, status: true, verifyCode: true, requestedAt: true },
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
