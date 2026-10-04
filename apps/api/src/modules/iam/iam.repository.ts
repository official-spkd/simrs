import { Injectable } from '@nestjs/common';
import { activeAssignments, lockTenantScope, type Prisma } from '@simrs/db';
import { ACCESS_ADMIN_GRANTS, newId, PROTECTED_ROLES, type TenantKind } from '@simrs/shared';
import { revokePinDevices } from '../../infra/auth/pin-devices';
import { TenantDb } from '../../infra/tenant-db';

const now = () => new Date();
const activeAt = (at: Date) => ({
  validFrom: { lte: at },
  OR: [{ validUntil: null }, { validUntil: { gt: at } }],
});
/** Baris izin yang membuat sebuah peran setara admin. */
const accessAdminGrant = { OR: ACCESS_ADMIN_GRANTS.map(([resource, action]) => ({ resource, action })) };

/** P03 · Data pengguna, penugasan, dan matriks peran (transaksi permintaan, RLS aktif). */
@Injectable()
export class IamRepository {
  constructor(private readonly db: TenantDb) {}

  listUsers(q: {
    cursor?: string;
    limit: number;
    search?: string;
    status?: string;
    role?: string;
    unitId?: string;
  }) {
    const at = now();
    const byAssignment =
      q.role || q.unitId
        ? {
            assignments: {
              some: {
                ...activeAt(at),
                ...(q.role ? { role: { code: q.role } } : {}),
                ...(q.unitId ? { unitId: q.unitId } : {}),
              },
            },
          }
        : {};
    return this.db.tx().user.findMany({
      where: {
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { username: { contains: q.search.toLowerCase() } },
                { displayName: { contains: q.search, mode: 'insensitive' } },
                { email: { contains: q.search.toLowerCase() } },
              ],
            }
          : {}),
        ...byAssignment,
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        mustChangePassword: true,
        createdAt: true,
        mfaFactors: {
          where: { disabledAt: null, confirmedAt: { not: null } },
          select: { id: true },
          take: 1,
        },
        assignments: {
          where: activeAt(at),
          select: {
            id: true,
            unitId: true,
            validUntil: true,
            role: { select: { code: true, name: true } },
            unit: { select: { name: true } },
          },
        },
      },
    });
  }

  findUser(id: string) {
    return this.db
      .tx()
      .user.findUnique({ where: { id }, select: { id: true, username: true, status: true } });
  }

  /** Detail satu pengguna untuk panel Akses: penugasan yang belum berakhir (berlaku sekarang atau akan datang). */
  findUserDetail(id: string) {
    return this.db.tx().user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        phoneEnc: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        mustChangePassword: true,
        createdAt: true,
        mfaFactors: {
          where: { disabledAt: null, confirmedAt: { not: null } },
          select: { id: true },
          take: 1,
        },
        assignments: {
          where: { OR: [{ validUntil: null }, { validUntil: { gt: now() } }] },
          orderBy: { validFrom: 'asc' },
          select: {
            id: true,
            unitId: true,
            validFrom: true,
            validUntil: true,
            role: { select: { code: true, name: true } },
            unit: { select: { name: true } },
          },
        },
        // PIN masuk cepat yang masih berlaku (ADR-0024), untuk ditinjau/dicabut admin.
        devices: {
          where: { kind: 'staff_pin', revokedAt: null, expiresAt: { gt: now() } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            createdAt: true,
            lastUsedAt: true,
            expiresAt: true,
            assignment: { select: { role: { select: { name: true } }, unit: { select: { name: true } } } },
          },
        },
      },
    });
  }

  /** PIN perangkat (jenis `staff_pin`) untuk dicabut admin. */
  findPinDevice(id: string) {
    return this.db.tx().registeredDevice.findFirst({
      where: { id, kind: 'staff_pin' },
      select: { userId: true, revokedAt: true },
    });
  }

  /** Angka ringkas layar Akses (MRMIK 2.1c: reviu akses berkala). */
  async summary(at: Date, dormantBefore: Date) {
    const tx = this.db.tx();
    const neverOrStale = {
      OR: [{ lastLoginAt: { lt: dormantBefore } }, { lastLoginAt: null, createdAt: { lt: dormantBefore } }],
    };
    return {
      total: await tx.user.count(),
      active: await tx.user.count({ where: { status: 'active' } }),
      locked: await tx.user.count({ where: { status: 'active', lockedUntil: { gt: at } } }),
      mfaMissing: await tx.user.count({
        where: { status: 'active', mfaFactors: { none: { disabledAt: null, confirmedAt: { not: null } } } },
      }),
      dormant: await tx.user.count({ where: { status: 'active', ...neverOrStale } }),
      breakGlass7d: await tx.breakGlassGrant.count({
        where: { grantedAt: { gte: new Date(at.getTime() - 7 * 86_400_000) } },
      }),
      breakGlassPending: await tx.breakGlassGrant.count({ where: { reviewOutcome: null } }),
    };
  }

  async tenantKind(): Promise<TenantKind> {
    const t = await this.db
      .tx()
      .tenant.findUnique({ where: { id: this.db.tenantId() }, select: { kind: true } });
    return t?.kind === 'platform' ? 'platform' : 'hospital';
  }

  /** Serialkan perubahan yang bisa mengurangi jumlah admin (lihat `lockTenantScope`). */
  lockAdminChanges() {
    return lockTenantScope(this.db.tx(), 'iam.admins');
  }

  async createUser(input: {
    username: string;
    displayName: string;
    email?: string;
    phoneEnc: string | null;
    passwordHash: string;
  }) {
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const actor = this.db.actorUserId();
    const id = newId();
    await tx.user.create({
      data: {
        id,
        tenantId,
        username: input.username,
        displayName: input.displayName,
        email: input.email ?? null,
        phoneEnc: input.phoneEnc,
        mustChangePassword: true,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await tx.userCredential.create({ data: { userId: id, tenantId, passwordHash: input.passwordHash } });
    return id;
  }

  updateUser(id: string, data: Prisma.UserUpdateInput) {
    return this.db.tx().user.update({
      where: { id },
      data: { ...data, updatedBy: this.db.actorUserId() },
      select: { id: true, username: true, displayName: true, email: true, status: true },
    });
  }

  /**
   * Sandi sementara baru. Akun tanpa kredensial (staf seed yang belum diaktifkan, `seedStaff`) mendapat kredensial
   * pertamanya di sini: reset oleh admin = cara mengaktifkan akun itu.
   */
  async resetPassword(id: string, passwordHash: string) {
    const tx = this.db.tx();
    await tx.userCredential.upsert({
      where: { userId: id },
      update: { passwordHash },
      create: { userId: id, tenantId: this.db.tenantId(), passwordHash },
    });
    await tx.user.update({
      where: { id },
      data: {
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedBy: this.db.actorUserId(),
      },
    });
  }

  resetMfa(id: string) {
    return this.db
      .tx()
      .mfaFactor.updateMany({ where: { userId: id, disabledAt: null }, data: { disabledAt: now() } });
  }

  /**
   * Cabut semua sesi aktif, perangkat tepercaya, dan PIN perangkat (reset sandi/MFA, nonaktif): login berikutnya
   * wajib sandi + MFA lagi, dan PIN harus didaftarkan ulang dari login penuh.
   */
  async revokeSessions(userId: string, reason: 'user_disabled' | 'password_reset' | 'mfa_reset') {
    await this.db.tx().trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now() },
    });
    await revokePinDevices(this.db.tx(), { userId }, reason, this.db.actorUserId());
    return this.db.tx().authSession.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'revoked', revokedAt: now(), revokedReason: reason },
    });
  }

  findRoleByCode(code: string) {
    return this.db.tx().role.findFirst({ where: { code, active: true }, select: { id: true, code: true } });
  }

  findUnit(id: string) {
    return this.db.tx().unit.findUnique({ where: { id }, select: { id: true, active: true } });
  }

  createAssignment(input: {
    userId: string;
    roleId: string;
    unitId?: string;
    validFrom?: Date;
    validUntil?: Date;
  }) {
    const actor = this.db.actorUserId();
    return this.db.tx().staffAssignment.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        userId: input.userId,
        roleId: input.roleId,
        unitId: input.unitId ?? null,
        ...(input.validFrom ? { validFrom: input.validFrom } : {}),
        validUntil: input.validUntil ?? null,
        createdBy: actor,
        updatedBy: actor,
      },
      select: {
        id: true,
        userId: true,
        unitId: true,
        validFrom: true,
        validUntil: true,
        role: { select: { code: true } },
      },
    });
  }

  findAssignment(id: string) {
    return this.db.tx().staffAssignment.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        roleId: true,
        validFrom: true,
        validUntil: true,
        role: { select: { code: true } },
      },
    });
  }

  async isAccessAdminRole(roleId: string): Promise<boolean> {
    return (await this.db.tx().rolePermission.count({ where: { roleId, ...accessAdminGrant } })) > 0;
  }

  /** Pengguna memegang (atau akan memegang) penugasan berperan setara admin. */
  async holdsAccessAdminRole(userId: string): Promise<boolean> {
    const n = await this.db.tx().staffAssignment.count({
      where: {
        userId,
        OR: [{ validUntil: null }, { validUntil: { gt: now() } }],
        role: { active: true, permissions: { some: accessAdminGrant } },
      },
    });
    return n > 0;
  }

  /** Akhiri penugasan; PIN perangkat untuk posisi itu ikut dicabut (sesi PIN-nya berakhir). */
  async endAssignment(id: string, at: Date, reason: string) {
    const r = await this.db.tx().staffAssignment.update({
      where: { id },
      data: { validUntil: at, endReason: reason, updatedBy: this.db.actorUserId() },
      select: { id: true, validUntil: true },
    });
    await revokePinDevices(this.db.tx(), { assignmentId: id }, 'assignment_ended', this.db.actorUserId());
    return r;
  }

  /** Cabut satu PIN perangkat (admin), mis. perangkat hilang atau staf pindah unit. */
  revokePinDevice(id: string) {
    return revokePinDevices(this.db.tx(), { id }, 'admin_revoked', this.db.actorUserId());
  }

  /** Jumlah pengguna AKTIF dengan penugasan admin yang masih berlaku, opsional mengecualikan satu penugasan/pengguna. */
  countActiveAdmins(exclude: { assignmentId?: string; userId?: string } = {}) {
    return this.db.tx().staffAssignment.count({
      where: {
        ...activeAt(now()),
        role: { code: { in: [...PROTECTED_ROLES] }, active: true },
        user: { status: 'active' },
        ...(exclude.assignmentId ? { id: { not: exclude.assignmentId } } : {}),
        ...(exclude.userId ? { userId: { not: exclude.userId } } : {}),
      },
    });
  }

  userActiveAssignments(userId: string) {
    return activeAssignments(this.db.tx(), userId);
  }

  listRoles() {
    return this.db.tx().role.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isSystem: true,
        active: true,
        permissions: {
          select: { resource: true, action: true, scope: true },
          orderBy: [{ resource: 'asc' }, { action: 'asc' }],
        },
      },
    });
  }

  async replaceRolePermissions(
    roleId: string,
    grants: Array<{ resource: string; action: string; scope: string }>,
  ) {
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const before = await tx.rolePermission.findMany({
      where: { roleId },
      select: { resource: true, action: true, scope: true },
    });
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (grants.length > 0) {
      await tx.rolePermission.createMany({
        data: grants.map((g) => ({ tenantId, roleId, ...g, updatedBy: this.db.actorUserId() })),
      });
    }
    return before;
  }
}
