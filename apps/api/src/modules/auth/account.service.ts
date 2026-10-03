import { Inject, Injectable } from '@nestjs/common';
import { readTenantSetting } from '@simrs/db';
import {
  AppError,
  type ChangePasswordInput,
  checkPasswordPolicy,
  PASSWORD_VIOLATION_MESSAGES,
} from '@simrs/shared';
import {
  decryptField,
  encryptField,
  generateTotpSecret,
  hashPassword,
  totpUri,
  verifyPassword,
  verifyTotp,
} from '@simrs/shared/node';
import { requestContext } from '../../common/request-context';
import { API_ENV, type ApiEnv } from '../../config/env';
import { SessionStore } from '../../infra/auth/session-store';
import { TenantDb } from '../../infra/tenant-db';
import { AuthRepository } from './auth.repository';

const MFA_ISSUER = 'SIM RS';

/** P02 · Akun pengguna yang sedang login: profil, logout, ganti kata sandi, pendaftaran MFA. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly repo: AuthRepository,
    private readonly sessions: SessionStore,
  ) {}

  /** Pengguna + sesi dari permintaan saat ini. Mode header pengembang tidak punya pengguna → 401. */
  private current() {
    const actor = requestContext.getStore()?.actor;
    if (!actor?.userId || !actor.sessionId) {
      throw new AppError('UNAUTHENTICATED', 'Endpoint ini membutuhkan login', 401);
    }
    return { userId: actor.userId, sessionId: actor.sessionId };
  }

  async me() {
    const { userId } = this.current();
    const session = await this.db.tx().authSession.findUnique({
      where: { id: this.current().sessionId },
      select: { mfaVerified: true, accessExpiresAt: true, refreshExpiresAt: true, unitId: true },
    });
    const p = await this.repo.findUserProfile(this.db.tx(), userId);
    if (!p || !session) throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid', 401);
    return {
      user: {
        id: p.id,
        username: p.username,
        displayName: p.displayName,
        email: p.email,
        mustChangePassword: p.mustChangePassword,
        lastLoginAt: p.lastLoginAt?.toISOString() ?? null,
      },
      tenant: p.tenant,
      mfa: { enrolled: p.mfaFactors.length > 0, sessionVerified: session.mfaVerified },
      session: {
        accessExpiresAt: session.accessExpiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString(),
        unitId: session.unitId,
      },
    };
  }

  async logout() {
    const { sessionId } = this.current();
    await this.sessions.revoke(this.db.tx(), sessionId, 'logout');
    this.db.audit({ action: 'logout', resourceType: 'session', resourceId: sessionId });
    return { loggedOut: true };
  }

  async changePassword(input: ChangePasswordInput) {
    const { userId, sessionId } = this.current();
    const tx = this.db.tx();
    const p = await this.repo.findUserProfile(tx, userId);
    const hash = p?.credential?.passwordHash;
    if (!p || !hash || !(await verifyPassword(input.currentPassword, hash))) {
      throw new AppError('UNAUTHENTICATED', 'Kata sandi saat ini salah', 401);
    }
    const minLength = await readTenantSetting(tx, 'password.min_length');
    const violations = checkPasswordPolicy(input.newPassword, {
      minLength,
      username: p.username,
      tenantCode: p.tenant.code,
    });
    if (await verifyPassword(input.newPassword, hash)) violations.push('common');
    if (violations.length > 0) {
      throw new AppError('PASSWORD_POLICY', 'Kata sandi baru tidak memenuhi kebijakan', 400, {
        violations,
        messages: [...new Set(violations)].map((v) => PASSWORD_VIOLATION_MESSAGES[v]),
        minLength,
      });
    }
    await this.repo.updatePasswordHash(tx, userId, await hashPassword(input.newPassword));
    await this.repo.markPasswordChanged(tx, userId);
    const revoked = await this.sessions.revokeAllForUser(tx, userId, 'password_changed', sessionId);
    this.db.audit({
      action: 'password_change',
      resourceType: 'user',
      resourceId: userId,
      details: { otherSessionsRevoked: revoked },
    });
    return { changed: true };
  }

  async startMfaEnrollment() {
    const { userId } = this.current();
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    if (await this.repo.findActiveFactor(tx, userId, true)) {
      throw new AppError(
        'CONFLICT',
        'Verifikasi dua langkah sudah aktif. Minta admin mereset bila perlu ganti perangkat.',
        409,
      );
    }
    const p = await this.repo.findUserProfile(tx, userId);
    if (!p) throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid', 401);
    const secret = generateTotpSecret();
    await this.repo.replacePendingFactor(
      tx,
      tenantId,
      userId,
      encryptField(secret, { keyB64: this.env.FIELD_ENCRYPTION_KEY, tenantId, purpose: 'mfa_secret' }),
    );
    // Rahasia hanya dikembalikan sekali, saat pendaftaran; setelah itu tersimpan terenkripsi.
    return { secret, otpauthUri: totpUri(secret, `${p.username}@${p.tenant.code}`, MFA_ISSUER) };
  }

  async confirmMfaEnrollment(code: string) {
    const { userId, sessionId } = this.current();
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const pending = await this.repo.findActiveFactor(tx, userId, false);
    if (!pending)
      throw new AppError('NOT_FOUND', 'Mulai pendaftaran verifikasi dua langkah terlebih dahulu', 404);
    const secret = decryptField(pending.secretEnc, {
      keyB64: this.env.FIELD_ENCRYPTION_KEY,
      tenantId,
      purpose: 'mfa_secret',
    });
    const v = verifyTotp(secret, code, { lastUsedStep: pending.lastUsedStep });
    if (!v.ok || v.step === undefined || !(await this.repo.markFactorUsed(tx, pending.id, v.step, true))) {
      throw new AppError('VALIDATION_FAILED', 'Kode verifikasi salah. Pastikan jam ponsel sudah benar.', 400);
    }
    await this.sessions.markMfaVerified(tx, sessionId);
    this.db.audit({
      action: 'mfa_enrolled',
      resourceType: 'user',
      resourceId: userId,
      details: { kind: 'totp' },
    });
    return { enrolled: true };
  }
}
