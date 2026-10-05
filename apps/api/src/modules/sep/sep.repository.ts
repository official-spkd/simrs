import { Injectable } from '@nestjs/common';
import { enqueueOutbox, type Prisma } from '@simrs/db';
import { type FrontOfficeOperation, newId, outboxKey } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

export const SEP_SELECT = {
  id: true,
  encounterId: true,
  coverageId: true,
  referralId: true,
  version: true,
  supersedesId: true,
  correctionReason: true,
  status: true,
  sepNo: true,
  serviceType: true,
  careClass: true,
  poliCode: true,
  diagnosisCode: true,
  diagnosisDisplay: true,
  note: true,
  lastErrorCode: true,
  rejectionReason: true,
  issuedAt: true,
  cancelledAt: true,
  cancelReason: true,
  syncStatus: true,
  syncedAt: true,
  syncErrorCode: true,
  syncSeq: true,
  encounter: { select: { patientId: true } },
  _count: { select: { supersededBy: true } },
} satisfies Prisma.SepSelect;
export type SepRow = Prisma.SepGetPayload<{ select: typeof SEP_SELECT }>;

/** F06 · Akses data SEP (berversi; isi beku setelah terbit, perubahan = baris versi baru). */
@Injectable()
export class SepRepository {
  constructor(private readonly db: TenantDb) {}

  findById(id: string) {
    return this.db.tx().sep.findUnique({ where: { id }, select: SEP_SELECT });
  }

  /** Kunci baris SEP (tindakan petugas vs hasil worker tidak saling menimpa). */
  async lock(id: string): Promise<boolean> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM seps WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  /** Versi terbaru rantai SEP kunjungan (yang tidak digantikan). */
  latestForEncounter(encounterId: string) {
    return this.db.tx().sep.findFirst({
      where: { encounterId },
      orderBy: { version: 'desc' },
      select: SEP_SELECT,
    });
  }

  create(data: Omit<Prisma.SepUncheckedCreateInput, 'tenantId' | 'createdBy'>) {
    return this.db.tx().sep.create({
      data: { ...data, tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() },
      select: SEP_SELECT,
    });
  }

  update(id: string, data: Prisma.SepUncheckedUpdateInput) {
    return this.db.tx().sep.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: SEP_SELECT,
    });
  }

  /** Antrekan kirim ke BPJS: kunci `<operasi>:<sep>:<urut>` (urut naik tiap kirim ulang). */
  enqueue(operation: FrontOfficeOperation, sepId: string, seq: number) {
    return enqueueOutbox(this.db.tx(), this.db.tenantId(), {
      target: 'bpjs',
      operation,
      idempotencyKey: outboxKey(operation, sepId, seq),
      payload: { sepId },
    });
  }

  // ---------- rujukan (hasil lookup VClaim disimpan untuk dasar SEP) ----------

  /** Layanan poli RS per kode poli BPJS (`external_ids` `bpjs:poli`). */
  async poliServicesByBpjsCode(): Promise<Map<string, { id: string; code: string }>> {
    const tx = this.db.tx();
    const ext = await tx.externalId.findMany({
      where: { entity: 'queue_service', system: 'bpjs:poli', active: true },
      select: { value: true, entityId: true },
    });
    const services = await tx.queueService.findMany({
      where: { id: { in: ext.map((e) => e.entityId) }, kind: 'poli', active: true },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    const byId = new Map(services.map((s) => [s.id, s]));
    const out = new Map<string, { id: string; code: string }>();
    for (const e of ext) {
      const s = byId.get(e.entityId);
      if (s && !out.has(e.value)) out.set(e.value, s);
    }
    return out;
  }

  findReferral(kind: string, number: string) {
    return this.db.tx().referral.findUnique({
      where: { tenantId_kind_number: { tenantId: this.db.tenantId(), kind, number } },
      select: { id: true, patientId: true },
    });
  }

  createReferral(data: Omit<Prisma.ReferralUncheckedCreateInput, 'id' | 'tenantId' | 'createdBy'>) {
    return this.db.tx().referral.create({
      data: { ...data, id: newId(), tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() },
      select: { id: true },
    });
  }

  updateReferral(id: string, data: Prisma.ReferralUncheckedUpdateInput) {
    return this.db.tx().referral.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: { id: true },
    });
  }

  /** Surat kontrol aktif milik pasien (dibuat RS sendiri; nomornya dari BPJS). */
  activeControlLetters(patientId: string) {
    return this.db.tx().referral.findMany({
      where: { patientId, kind: 'surat-kontrol', status: 'active', number: { not: null } },
      orderBy: { issuedOn: 'desc' },
      select: {
        id: true,
        number: true,
        facilityName: true,
        diagnosisCode: true,
        diagnosisDisplay: true,
        issuedOn: true,
        validUntil: true,
        practitionerId: true,
        targetService: { select: { code: true } },
      },
    });
  }

  /** No. kartu BPJS pasien (terenkripsi) untuk lookup. */
  patientCard(patientId: string) {
    return this.db.tx().patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        status: true,
        identifiers: { where: { active: true, system: 'bpjs' }, select: { valueEnc: true } },
      },
    });
  }
}
