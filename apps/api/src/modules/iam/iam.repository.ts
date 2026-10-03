import { Injectable } from '@nestjs/common';
import { activeAssignments, lockTenantScope, type Prisma } from '@simrs/db';
import { ACCESS_ADMIN_GRANTS, newId, PROTECTED_ROLES, type TenantKind } from '@simrs/shared';
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

  listUsers(q: { cursor?: string; limit: number; search?: string; status?: string }) {
    const at = now();
    return this.db.tx().user.findMany({
      where: {
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { username: { contains: q.search.toLowerCase() } },
                { displayName: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
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

  async createUser(input: { username: string; displayName: string; email?: string; passwordHash: string }) {
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

  async resetPassword(id: string, passwordHash: string) {
    const tx = this.db.tx();
    await tx.userCredential.update({ where: { userId: id }, data: { passwordHash } });
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

  revokeSessions(userId: string, reason: string) {
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

  endAssignment(id: string, at: Date, reason: string) {
    return this.db.tx().staffAssignment.update({
      where: { id },
      data: { validUntil: at, endReason: reason, updatedBy: this.db.actorUserId() },
      select: { id: true, validUntil: true },
    });
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
