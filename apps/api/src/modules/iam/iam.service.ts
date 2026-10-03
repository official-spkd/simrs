import { Injectable } from '@nestjs/common';
import {
  ACCESS_ADMIN_GRANTS,
  type AssignmentInput,
  AppError,
  type CreateUserInput,
  isPermission,
  PERMISSION_CATALOG,
  isProtectedRole,
  permissionAllowedFor,
  type RolePermissionsInput,
  type UpdateUserInput,
} from '@simrs/shared';
import { generateTemporaryPassword, hashPassword } from '@simrs/shared/node';
import { toPage } from '../../common/pagination';
import { DEV_ROLE } from '../../common/request-context';
import { TenantDb } from '../../infra/tenant-db';
import { IamRepository } from './iam.repository';

/** Akun yang tidak login selama ini dianggap dorman (MRMIK 2.1c, reviu akses berkala). */
const DORMANT_DAYS = 60;

const conflict = (message: string) => new AppError('CONFLICT', message, 409);
const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 400);

/**
 * P03 · Manajemen pengguna dan akses. Aturan pengaman:
 * - admin tidak bisa menonaktifkan/mereset/menambah peran dirinya lewat jalur admin (pakai menu akun sendiri);
 * - selalu tersisa minimal satu admin aktif;
 * - akun dan peran setara admin hanya dikelola admin SIM RS, walau izin kelola pengguna didelegasikan;
 * - kata sandi sementara ditampilkan sekali, wajib diganti saat login pertama;
 * - menonaktifkan/mereset akun mencabut seluruh sesinya seketika.
 */
@Injectable()
export class IamService {
  constructor(
    private readonly repo: IamRepository,
    private readonly db: TenantDb,
  ) {}

  private assertNotSelf(userId: string, what: string) {
    if (userId === this.db.actorUserId()) throw conflict(`Tidak bisa ${what} akun sendiri lewat menu admin`);
  }

  /** Pemegang izin kelola pengguna hasil delegasi tidak boleh menyentuh akun/peran setara admin (eskalasi). */
  private async assertMayManage(target: { userId?: string; roleId?: string }) {
    const role = this.db.actor().role;
    if (isProtectedRole(role) || role === DEV_ROLE) return;
    const privileged =
      (target.roleId !== undefined && (await this.repo.isAccessAdminRole(target.roleId))) ||
      (target.userId !== undefined && (await this.repo.holdsAccessAdminRole(target.userId)));
    if (privileged) {
      throw new AppError(
        'FORBIDDEN',
        'Hanya admin SIM RS yang boleh mengelola akun atau peran setara admin',
        403,
      );
    }
  }

  /**
   * Tolak perubahan yang membuat admin aktif habis. Hanya berlaku bila perubahan itu benar-benar mengurangi
   * admin aktif (pengguna/penugasan non-admin atau yang belum mulai tidak terpengaruh). Dikunci per tenant
   * agar dua admin yang saling menonaktifkan bersamaan tidak sama-sama lolos.
   */
  private async assertKeepsAnAdmin(exclude: { assignmentId?: string; userId?: string }) {
    await this.repo.lockAdminChanges();
    const before = await this.repo.countActiveAdmins();
    if (before > 0 && (await this.repo.countActiveAdmins(exclude)) === 0) {
      throw conflict('Harus tersisa minimal satu admin SIM RS aktif');
    }
  }

  async listUsers(q: { cursor?: string; limit: number; search?: string; status?: string }) {
    const page = toPage(await this.repo.listUsers(q), q.limit);
    const dormantBefore = Date.now() - DORMANT_DAYS * 86_400_000;
    return {
      ...page,
      items: page.items.map(({ mfaFactors, lockedUntil, ...u }) => ({
        ...u,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        mfaEnrolled: mfaFactors.length > 0,
        locked: !!lockedUntil && lockedUntil.getTime() > Date.now(),
        dormant: u.status === 'active' && (!u.lastLoginAt || u.lastLoginAt.getTime() < dormantBefore),
        assignments: u.assignments.map((a) => ({
          id: a.id,
          roleCode: a.role.code,
          roleName: a.role.name,
          unitId: a.unitId,
          unitName: a.unit?.name ?? null,
          validUntil: a.validUntil?.toISOString() ?? null,
        })),
      })),
    };
  }

  async createUser(input: CreateUserInput) {
    const temporaryPassword = generateTemporaryPassword();
    const id = await this.repo.createUser({
      username: input.username,
      displayName: input.displayName,
      email: input.email,
      passwordHash: await hashPassword(temporaryPassword),
    });
    for (const a of input.assignments) await this.addAssignment(id, a);
    // Sandi sementara HANYA dikembalikan di respons ini (tidak dicatat di log/audit).
    return { id, username: input.username, temporaryPassword };
  }

  async updateUser(id: string, input: UpdateUserInput) {
    const user = await this.repo.findUser(id);
    if (!user) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan', 404);
    await this.assertMayManage({ userId: id });
    if (input.status === 'disabled') {
      this.assertNotSelf(id, 'menonaktifkan');
      await this.assertKeepsAnAdmin({ userId: id });
    }
    const updated = await this.repo.updateUser(id, input);
    if (input.status === 'disabled') await this.repo.revokeSessions(id, 'user_disabled');
    return updated;
  }

  async resetPassword(id: string) {
    this.assertNotSelf(id, 'mereset kata sandi');
    if (!(await this.repo.findUser(id))) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan', 404);
    await this.assertMayManage({ userId: id });
    const temporaryPassword = generateTemporaryPassword();
    await this.repo.resetPassword(id, await hashPassword(temporaryPassword));
    await this.repo.revokeSessions(id, 'password_reset');
    return { id, temporaryPassword };
  }

  async resetMfa(id: string) {
    this.assertNotSelf(id, 'mereset verifikasi dua langkah');
    if (!(await this.repo.findUser(id))) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan', 404);
    await this.assertMayManage({ userId: id });
    const r = await this.repo.resetMfa(id);
    await this.repo.revokeSessions(id, 'mfa_reset');
    return { id, factorsDisabled: r.count };
  }

  async addAssignment(userId: string, input: AssignmentInput) {
    this.assertNotSelf(userId, 'menambah peran pada');
    if (!(await this.repo.findUser(userId))) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan', 404);
    const role = await this.repo.findRoleByCode(input.roleCode);
    if (!role) throw invalid(`Peran ${input.roleCode} tidak ditemukan atau tidak aktif`);
    await this.assertMayManage({ roleId: role.id });
    if (input.unitId) {
      const unit = await this.repo.findUnit(input.unitId);
      if (!unit?.active) throw invalid('Unit tidak ditemukan atau tidak aktif');
    }
    const validFrom = input.validFrom ? new Date(input.validFrom) : undefined;
    const validUntil = input.validUntil ? new Date(input.validUntil) : undefined;
    if (validUntil && validUntil <= (validFrom ?? new Date()))
      throw invalid('Akhir penugasan harus setelah awalnya');
    const a = await this.repo.createAssignment({
      userId,
      roleId: role.id,
      unitId: input.unitId,
      validFrom,
      validUntil,
    });
    return { ...a, validFrom: a.validFrom.toISOString(), validUntil: a.validUntil?.toISOString() ?? null };
  }

  /** Akhiri penugasan sekarang. Penugasan yang belum mulai dibatalkan (rentang kosong: akhir = awal). */
  async endAssignment(assignmentId: string, reason: string) {
    const a = await this.repo.findAssignment(assignmentId);
    if (!a) throw new AppError('NOT_FOUND', 'Penugasan tidak ditemukan', 404);
    const end = new Date(Math.max(Date.now(), a.validFrom.getTime()));
    if (a.validUntil && a.validUntil <= end) throw conflict('Penugasan sudah berakhir');
    await this.assertMayManage({ roleId: a.roleId });
    if (isProtectedRole(a.role.code)) await this.assertKeepsAnAdmin({ assignmentId });
    const r = await this.repo.endAssignment(assignmentId, end, reason);
    return { id: r.id, validUntil: r.validUntil?.toISOString() ?? null };
  }

  async listRoles() {
    const roles = await this.repo.listRoles();
    return {
      catalog: Object.entries(PERMISSION_CATALOG).map(([resource, def]) => ({
        resource,
        label: def.label,
        actions: def.actions,
      })),
      roles,
    };
  }

  /** Ganti matriks izin satu peran. Mengembalikan selisih (untuk audit). */
  async replaceRolePermissions(code: string, input: RolePermissionsInput) {
    const role = await this.repo.findRoleByCode(code);
    if (!role) throw new AppError('NOT_FOUND', 'Peran tidak ditemukan', 404);
    const keys = input.grants.map((g) => `${g.resource}.${g.action}`);
    if (new Set(keys).size !== keys.length) throw invalid('Izin ganda dalam satu peran');
    if (!input.grants.every((g) => isPermission(g.resource, g.action))) throw invalid('Izin tidak dikenal');
    const kind = await this.repo.tenantKind();
    if (!input.grants.every((g) => permissionAllowedFor(kind, g.resource))) {
      throw invalid('Izin platform tidak bisa diberikan ke peran RS');
    }
    if (isProtectedRole(code)) {
      const missing = ACCESS_ADMIN_GRANTS.filter(
        ([r, a]) => !input.grants.some((g) => g.resource === r && g.action === a && g.scope === 'all'),
      );
      if (missing.length > 0)
        throw conflict('Izin kelola pengguna dan peran tidak boleh dicabut dari admin SIM RS');
    }
    const before = await this.repo.replaceRolePermissions(role.id, input.grants);
    const fmt = (g: { resource: string; action: string; scope: string }) =>
      `${g.resource}.${g.action}:${g.scope}`;
    const beforeSet = new Set(before.map(fmt));
    const afterSet = new Set(input.grants.map(fmt));
    const diff = {
      added: [...afterSet].filter((x) => !beforeSet.has(x)).sort(),
      removed: [...beforeSet].filter((x) => !afterSet.has(x)).sort(),
    };
    this.db.audit({ action: 'update', resourceType: 'role_permissions', resourceId: code, details: diff });
    return { code, ...diff };
  }
}
