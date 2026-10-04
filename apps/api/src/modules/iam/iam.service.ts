import { Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_ADMIN_GRANTS,
  type AssignmentInput,
  AppError,
  type CreateUserInput,
  isPermission,
  PERMISSION_CATALOG,
  isProtectedRole,
  maskPhone,
  permissionAllowedFor,
  type RolePermissionsInput,
  type UpdateUserInput,
} from '@simrs/shared';
import { decryptField, encryptField, generateTemporaryPassword, hashPassword } from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
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
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** No. HP staf terenkripsi per tenant (`staff_phone`); layar hanya menerima bentuk tersamar. */
  private encryptPhone(phone: string): string {
    return encryptField(phone, {
      keyB64: this.env.FIELD_ENCRYPTION_KEY,
      tenantId: this.db.tenantId(),
      purpose: 'staff_phone',
    });
  }

  private maskedPhone(phoneEnc: string | null): string | null {
    if (!phoneEnc) return null;
    try {
      return maskPhone(
        decryptField(phoneEnc, {
          keyB64: this.env.FIELD_ENCRYPTION_KEY,
          tenantId: this.db.tenantId(),
          purpose: 'staff_phone',
        }),
      );
    } catch {
      return 'tidak terbaca';
    }
  }

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

  /** Keadaan akun untuk reviu akses: dorman = aktif tapi tidak login 60 hari (atau tidak pernah, sejak dibuat). */
  private accountFlags(
    u: {
      status: string;
      lastLoginAt: Date | null;
      lockedUntil: Date | null;
      createdAt: Date;
      mfaFactors: unknown[];
    },
    at: number,
  ) {
    const dormantBefore = at - DORMANT_DAYS * 86_400_000;
    const active = u.status === 'active';
    return {
      mfaEnrolled: u.mfaFactors.length > 0,
      locked: active && !!u.lockedUntil && u.lockedUntil.getTime() > at,
      /** Belum pernah login sejak dibuat (akun baru / undangan). */
      neverLoggedIn: !u.lastLoginAt,
      dormant:
        active &&
        (u.lastLoginAt ? u.lastLoginAt.getTime() < dormantBefore : u.createdAt.getTime() < dormantBefore),
    };
  }

  async listUsers(q: {
    cursor?: string;
    limit: number;
    search?: string;
    status?: string;
    role?: string;
    unitId?: string;
  }) {
    const page = toPage(await this.repo.listUsers(q), q.limit);
    const at = Date.now();
    return {
      ...page,
      items: page.items.map(({ mfaFactors, lockedUntil, createdAt, ...u }) => ({
        ...u,
        ...this.accountFlags({ ...u, mfaFactors, lockedUntil, createdAt }, at),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
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

  /** Detail pengguna + penugasan yang belum berakhir (yang dibatalkan sebelum mulai tidak ditampilkan). */
  async userDetail(id: string) {
    const u = await this.repo.findUserDetail(id);
    if (!u) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan', 404);
    const at = Date.now();
    const { mfaFactors, lockedUntil, createdAt, assignments, phoneEnc, devices, ...rest } = u;
    return {
      ...rest,
      phone: this.maskedPhone(phoneEnc),
      /** PIN masuk cepat yang masih berlaku (ADR-0024). */
      pinDevices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        roleName: d.assignment?.role.name ?? '',
        unitName: d.assignment?.unit?.name ?? null,
        createdAt: d.createdAt.toISOString(),
        lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
        expiresAt: d.expiresAt.toISOString(),
      })),
      ...this.accountFlags({ ...u, mfaFactors, lockedUntil, createdAt }, at),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
      assignments: assignments
        .filter((a) => !a.validUntil || a.validUntil > a.validFrom)
        .map((a) => ({
          id: a.id,
          roleCode: a.role.code,
          roleName: a.role.name,
          unitId: a.unitId,
          unitName: a.unit?.name ?? null,
          validFrom: a.validFrom.toISOString(),
          validUntil: a.validUntil?.toISOString() ?? null,
          /** Belum mulai berlaku (mis. rotasi bulan depan). */
          pending: a.validFrom.getTime() > at,
        })),
    };
  }

  async summary() {
    const at = new Date();
    const s = await this.repo.summary(at, new Date(at.getTime() - DORMANT_DAYS * 86_400_000));
    return { ...s, dormantDays: DORMANT_DAYS };
  }

  async createUser(input: CreateUserInput) {
    const temporaryPassword = generateTemporaryPassword();
    const id = await this.repo.createUser({
      username: input.username,
      displayName: input.displayName,
      email: input.email,
      phoneEnc: input.phone ? this.encryptPhone(input.phone) : null,
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
    const { phone, ...fields } = input;
    const updated = await this.repo.updateUser(id, {
      ...fields,
      ...(phone !== undefined ? { phoneEnc: phone === null ? null : this.encryptPhone(phone) } : {}),
    });
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

  /** Cabut PIN masuk cepat di satu perangkat milik pengguna lain (ADR-0024); sesi PIN-nya ikut berakhir. */
  async revokePinDevice(id: string) {
    const d = await this.repo.findPinDevice(id);
    if (!d?.userId || d.revokedAt) throw new AppError('NOT_FOUND', 'Perangkat ber-PIN tidak ditemukan', 404);
    this.assertNotSelf(d.userId, 'mencabut PIN');
    await this.assertMayManage({ userId: d.userId });
    await this.repo.revokePinDevice(id);
    return { id, revoked: true };
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
