import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import { DEVICE_PRINCIPAL_KINDS, type DevicePrincipalKind } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const viewSelect = {
  id: true,
  kind: true,
  name: true,
  createdAt: true,
  expiresAt: true,
  enrolExpiresAt: true,
  enrolledAt: true,
  lastUsedAt: true,
  revokedAt: true,
  unit: { select: { id: true, name: true } },
  queueDisplay: { select: { id: true, name: true } },
} as const;

export interface DeviceRow {
  id: string;
  kind: string;
  name: string;
  createdAt: Date;
  expiresAt: Date;
  enrolExpiresAt: Date | null;
  enrolledAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  unit: { id: string; name: string } | null;
  queueDisplay: { id: string; name: string } | null;
}

/** ADR-0027 · Data perangkat prinsipal (anjungan/TV) di `registered_devices`. Jenis `staff_pin` tidak disentuh. */
@Injectable()
export class DevicesRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Terbaru dulu (id UUID v7 turun): perangkat yang baru dibuat admin, beserta kodenya yang masih menunggu, selalu di
   * halaman pertama walau RS sudah punya banyak perangkat. Kursor = id terakhir halaman sebelumnya.
   */
  list(opts: { kind?: DevicePrincipalKind; cursor?: string; limit: number }): Promise<DeviceRow[]> {
    return this.db.tx().registeredDevice.findMany({
      where: {
        kind: opts.kind ?? { in: [...DEVICE_PRINCIPAL_KINDS] },
        ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: opts.limit + 1,
      select: viewSelect,
    });
  }

  find(id: string): Promise<DeviceRow | null> {
    return this.db.tx().registeredDevice.findFirst({
      where: { id, kind: { in: [...DEVICE_PRINCIPAL_KINDS] } },
      select: viewSelect,
    });
  }

  activeQueueDisplay(id: string) {
    return this.db.tx().queueDisplay.findFirst({ where: { id, active: true }, select: { id: true } });
  }

  activeUnit(unitId: string) {
    return this.db.tx().unit.findFirst({ where: { id: unitId, active: true }, select: { id: true } });
  }

  async create(data: {
    id: string;
    kind: DevicePrincipalKind;
    name: string;
    unitId: string;
    queueDisplayId: string | null;
    enrolCodeHash: string;
    enrolExpiresAt: Date;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<DeviceRow> {
    return this.db.tx().registeredDevice.create({
      data: { ...data, tenantId: this.db.tenantId(), createdBy: this.db.actorUserId() },
      select: viewSelect,
    });
  }

  async revoke(id: string): Promise<number> {
    const r = await this.db.tx().registeredDevice.updateMany({
      where: { id, kind: { in: [...DEVICE_PRINCIPAL_KINDS] }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'admin_revoked', revokedBy: this.db.actorUserId() },
    });
    return r.count;
  }

  /**
   * Perangkat yang menunggu pendaftaran dengan HMAC kode ini (dipakai di luar permintaan bertenant). `kinds` membatasi
   * jalur: kode analyzer tidak berlaku di pendaftaran peramban dan sebaliknya (kode tidak terpakai).
   */
  static findPendingByCode(
    tx: TenantTx,
    codeHash: string,
    kinds: readonly string[] = DEVICE_PRINCIPAL_KINDS,
  ) {
    return tx.registeredDevice.findFirst({
      where: {
        enrolCodeHash: codeHash,
        kind: { in: [...kinds] },
        enrolledAt: null,
        revokedAt: null,
      },
      select: { id: true, kind: true, name: true, enrolExpiresAt: true },
    });
  }

  /** Daftarkan perangkat sekali (penjaga database menolak bila sudah terdaftar, dicabut, atau kode kedaluwarsa). */
  static async completeEnrolment(
    tx: TenantTx,
    id: string,
    data: { tokenHash: string; userAgent: string | null; hmacKeyEnc?: string | null },
  ): Promise<boolean> {
    const r = await tx.registeredDevice.updateMany({
      where: { id, enrolledAt: null, revokedAt: null },
      data: { ...data, enrolledAt: new Date(), enrolCodeHash: null, lastUsedAt: new Date() },
    });
    return r.count === 1;
  }

  static self(tx: TenantTx, id: string) {
    return tx.registeredDevice.findFirst({
      where: { id },
      select: {
        id: true,
        kind: true,
        name: true,
        expiresAt: true,
        unit: { select: { id: true, name: true } },
        queueDisplay: { select: { id: true, name: true } },
        tenant: { select: { name: true } },
      },
    });
  }
}
