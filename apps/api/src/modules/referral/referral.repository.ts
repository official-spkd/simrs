import { Injectable } from '@nestjs/common';
import { enqueueOutbox, type Prisma } from '@simrs/db';
import { type FrontOfficeOperation, newId, outboxKey } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

export const REFERRAL_SELECT = {
  id: true,
  kind: true,
  status: true,
  number: true,
  patientId: true,
  encounterId: true,
  ppkCode: true,
  facilityName: true,
  targetServiceId: true,
  targetUnitId: true,
  practitionerId: true,
  diagnosisCode: true,
  diagnosisDisplay: true,
  issuedOn: true,
  validUntil: true,
  visitNo: true,
  plannedDate: true,
  serviceType: true,
  referralType: true,
  bpjsPoliCode: true,
  note: true,
  syncStatus: true,
  syncedAt: true,
  syncErrorCode: true,
  syncSeq: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
} satisfies Prisma.ReferralSelect;
export type ReferralRow = Prisma.ReferralGetPayload<{ select: typeof REFERRAL_SELECT }>;

/** F06/F07 · Akses data rujukan, SPRI, dan surat kontrol (`referrals`). */
@Injectable()
export class ReferralRepository {
  constructor(private readonly db: TenantDb) {}

  findById(id: string) {
    return this.db.tx().referral.findUnique({ where: { id }, select: REFERRAL_SELECT });
  }

  /** Kunci baris (tindakan petugas vs hasil worker tidak saling menimpa). */
  async lock(id: string): Promise<boolean> {
    const rows = await this.db.tx().$queryRaw<Array<{ id: string }>>`
      SELECT id FROM referrals WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  list(f: {
    cursor?: string;
    limit: number;
    patientId?: string;
    encounterId?: string;
    kind?: string;
    status?: string;
  }) {
    return this.db.tx().referral.findMany({
      where: {
        ...(f.cursor ? { id: { gt: f.cursor } } : {}),
        ...(f.patientId ? { patientId: f.patientId } : {}),
        ...(f.encounterId ? { encounterId: f.encounterId } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.status ? { status: f.status } : {}),
      },
      orderBy: { id: 'asc' },
      take: f.limit,
      select: REFERRAL_SELECT,
    });
  }

  create(data: Omit<Prisma.ReferralUncheckedCreateInput, 'id' | 'tenantId' | 'createdBy'>) {
    return this.db.tx().referral.create({
      data: { ...data, id: newId(), tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() },
      select: REFERRAL_SELECT,
    });
  }

  update(id: string, data: Prisma.ReferralUncheckedUpdateInput) {
    return this.db.tx().referral.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: REFERRAL_SELECT,
    });
  }

  /** Antrekan kirim ke BPJS: kunci `<operasi>:<rujukan>:<urut>` (urut naik tiap kirim ulang/hapus). */
  enqueue(operation: FrontOfficeOperation, referralId: string, seq: number) {
    return enqueueOutbox(this.db.tx(), this.db.tenantId(), {
      target: 'bpjs',
      operation,
      idempotencyKey: outboxKey(operation, referralId, seq),
      payload: { referralId },
    });
  }

  /** Kunjungan asal + penjamin utama + SEP terbaru (dasar surat kontrol, SPRI, rujukan keluar/internal). */
  sourceEncounter(id: string) {
    return this.db.tx().encounter.findUnique({
      where: { id },
      select: {
        id: true,
        patientId: true,
        status: true,
        encounterClass: true,
        serviceId: true,
        service: { select: { name: true } },
        unit: { select: { name: true } },
        coverages: {
          where: { status: 'active' },
          orderBy: { priority: 'asc' },
          take: 1,
          select: { payer: { select: { kind: true } }, patientIdentifierId: true },
        },
        seps: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { status: true, sepNo: true, diagnosisCode: true, diagnosisDisplay: true },
        },
      },
    });
  }

  poliService(id: string) {
    return this.db.tx().queueService.findUnique({
      where: { id },
      select: { id: true, kind: true, active: true, name: true },
    });
  }

  unit(id: string) {
    return this.db
      .tx()
      .unit.findUnique({ where: { id }, select: { id: true, kind: true, active: true, name: true } });
  }

  practitioner(id: string) {
    return this.db.tx().practitioner.findUnique({
      where: { id },
      select: { id: true, active: true, profession: true },
    });
  }

  externalId(entity: 'practitioner' | 'queue_service', entityId: string, system: string) {
    return this.db.tx().externalId.findFirst({
      where: { entity, entityId, system, active: true },
      select: { value: true },
    });
  }

  /** Poli (layanan antrean) tempat dokter praktik menurut templat jadwal aktif yang punya kode poli BPJS. */
  async practitionerBpjsPoli(practitionerId: string): Promise<{ serviceId: string; code: string } | null> {
    const tx = this.db.tx();
    const schedules = await tx.practitionerSchedule.findMany({
      where: { practitionerId, active: true },
      orderBy: { validFrom: 'desc' },
      select: { serviceId: true },
    });
    for (const serviceId of new Set(schedules.map((s) => s.serviceId))) {
      const ext = await this.externalId('queue_service', serviceId, 'bpjs:poli');
      if (ext) return { serviceId, code: ext.value };
    }
    return null;
  }

  /** Admisi yang tidak batal yang memakai SPRI ini. */
  admissionForReferral(referralId: string) {
    return this.db.tx().encounter.findFirst({
      where: { referralId, status: { not: 'cancelled' } },
      select: { id: true },
    });
  }
}
