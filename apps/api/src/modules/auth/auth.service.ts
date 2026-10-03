import { Inject, Injectable } from '@nestjs/common';
import { readTenantSetting, resolveTenantByCode, resolveTenantByHost, type TenantTx } from '@simrs/db';
import { AppError, type LoginInput, type MfaVerifyInput, newId, type SessionTokens } from '@simrs/shared';
import {
  decryptField,
  dummyPasswordHash,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyTotp,
} from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
import { type AuditMeta, writeAudit } from '../../infra/audit-writer';
import { SessionStore } from '../../infra/auth/session-store';
import { issueToken, parseToken, secretMatches } from '../../infra/auth/session-tokens';
import { PrismaService } from '../../infra/prisma.service';
import { AuthRepository } from './auth.repository';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  host: string | null;
}

export type LoginResult =
  | { status: 'mfa_required'; challengeToken: string; challengeExpiresAt: string }
  | ({ status: 'mfa_enrollment_required'; mustChangePassword: boolean } & SessionTokens);

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;

/** Pesan seragam untuk semua kegagalan login: tidak membedakan pengguna tak dikenal, sandi salah, atau terkunci. */
const loginFailed = () =>
  new AppError(
    'UNAUTHENTICATED',
    'NIP/email atau kata sandi salah, atau akun terkunci sementara. Coba lagi beberapa menit lagi atau hubungi admin SIM RS.',
    401,
  );
const challengeFailed = () =>
  new AppError('UNAUTHENTICATED', 'Kode verifikasi salah atau sudah kedaluwarsa', 401);

/**
 * P02 · Alur login: kata sandi → kode TOTP → sesi. Berjalan di luar transaksi permintaan karena tenant
 * baru diketahui dari kode RS/host. Status kegagalan (hitungan gagal, kunci akun, audit) DI-COMMIT lebih dulu,
 * baru kemudian galat 401 dilempar, sehingga tidak ikut batal.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
    private readonly repo: AuthRepository,
    private readonly sessions: SessionStore,
  ) {}

  /** Produksi: RS dari host (subdomain). Lokal/staging: kode RS dari formulir, host sebagai cadangan. */
  private async resolveTenant(input: LoginInput, host: string | null): Promise<string | null> {
    if (this.env.APP_ENV === 'production') return host ? resolveTenantByHost(this.prisma.client, host) : null;
    if (input.tenantCode) return resolveTenantByCode(this.prisma.client, input.tenantCode);
    return host ? resolveTenantByHost(this.prisma.client, host) : null;
  }

  private meta(m: RequestMeta, actorUserId: string | null): AuditMeta {
    return { actorUserId, actorRole: null, ip: m.ip, userAgent: m.userAgent, requestId: m.requestId };
  }

  async login(input: LoginInput, m: RequestMeta): Promise<LoginResult> {
    const tenantId = await this.resolveTenant(input, m.host);
    if (!tenantId) {
      // Samakan waktu respons dengan jalur sandi salah (anti-enumerasi RS/akun).
      await verifyPassword(input.password, await dummyPasswordHash());
      throw loginFailed();
    }

    const user = await this.prisma.forTenant(tenantId, (tx) =>
      this.repo.findLoginCandidate(tx, input.username),
    );
    const hash = user?.credential?.passwordHash;
    const passwordOk = await verifyPassword(input.password, hash ?? (await dummyPasswordHash()));
    const now = new Date();
    const locked = !!user?.lockedUntil && user.lockedUntil > now;

    if (!user || !hash || user.status !== 'active' || locked || !passwordOk) {
      await this.prisma.forTenant(tenantId, async (tx) => {
        let lockedNow = locked;
        if (user && hash && user.status === 'active' && !locked && !passwordOk) {
          const max = await readTenantSetting(tx, 'login.max_failed_attempts');
          const lockMinutes = await readTenantSetting(tx, 'login.lockout_minutes');
          const r = await this.repo.recordFailedLogin(tx, user.id, max, lockMinutes);
          lockedNow = !!r?.locked_until && r.locked_until > now;
        }
        const reason =
          !user || !hash
            ? 'unknown_user'
            : user.status !== 'active'
              ? 'disabled'
              : locked
                ? 'locked'
                : 'bad_password';
        await writeAudit(tx, tenantId, this.meta(m, user?.id ?? null), [
          {
            action: 'login_failed',
            resourceType: 'session',
            outcome: 'denied',
            details: { reason, locked: lockedNow },
          },
        ]);
      });
      throw loginFailed();
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      await this.repo.recordSuccessfulLogin(tx, user.id);
      if (needsRehash(hash))
        await this.repo.updatePasswordHash(tx, user.id, await hashPassword(input.password));

      if (user.mfaFactors.length > 0) {
        const id = newId();
        const challenge = issueToken('sc1', tenantId, id);
        const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
        await this.repo.createChallenge(tx, {
          id,
          tenantId,
          userId: user.id,
          secretHash: challenge.hash,
          expiresAt,
        });
        return {
          status: 'mfa_required',
          challengeToken: challenge.token,
          challengeExpiresAt: expiresAt.toISOString(),
        };
      }

      // Belum punya MFA: sesi terbatas yang hanya bisa mendaftarkan MFA / ganti sandi (AuthGuard menegakkan).
      const tokens = await this.createSession(tx, tenantId, user.id, false, m);
      await writeAudit(tx, tenantId, this.meta(m, user.id), [
        {
          action: 'login',
          resourceType: 'session',
          resourceId: tokens.sessionId,
          details: { mfa: 'enrollment_required' },
        },
      ]);
      const { sessionId: _s, ...rest } = tokens;
      return { status: 'mfa_enrollment_required', mustChangePassword: user.mustChangePassword, ...rest };
    });
  }

  async verifyMfa(
    input: MfaVerifyInput,
    m: RequestMeta,
  ): Promise<SessionTokens & { mustChangePassword: boolean }> {
    const parsed = parseToken(input.challengeToken, 'sc1');
    if (!parsed) throw challengeFailed();
    const tenantId = parsed.tenantId;

    const outcome = await this.prisma.forTenant(tenantId, async (tx) => {
      const ch = await this.repo.findChallenge(tx, parsed.id);
      if (
        !ch ||
        ch.consumedAt ||
        ch.expiresAt <= new Date() ||
        !secretMatches(parsed.secret, ch.secretHash)
      ) {
        return { ok: false as const, userId: ch?.userId ?? null, reason: 'invalid_challenge' };
      }
      const factor = await this.repo.findActiveFactor(tx, ch.userId, true);
      const secret = factor
        ? decryptField(factor.secretEnc, {
            keyB64: this.env.FIELD_ENCRYPTION_KEY,
            tenantId,
            purpose: 'mfa_secret',
          })
        : null;
      const v = secret
        ? verifyTotp(secret, input.code, { lastUsedStep: factor?.lastUsedStep })
        : { ok: false };
      if (
        !factor ||
        !v.ok ||
        v.step === undefined ||
        !(await this.repo.markFactorUsed(tx, factor.id, v.step))
      ) {
        await this.repo.failChallenge(tx, ch.id, CHALLENGE_MAX_ATTEMPTS);
        return { ok: false as const, userId: ch.userId, reason: 'bad_totp' };
      }
      if (!(await this.repo.consumeChallenge(tx, ch.id))) {
        return { ok: false as const, userId: ch.userId, reason: 'challenge_reused' };
      }
      const profile = await this.repo.findUserProfile(tx, ch.userId);
      const tokens = await this.createSession(tx, tenantId, ch.userId, true, m);
      await writeAudit(tx, tenantId, this.meta(m, ch.userId), [
        { action: 'login', resourceType: 'session', resourceId: tokens.sessionId, details: { mfa: 'totp' } },
      ]);
      const { sessionId: _s, ...rest } = tokens;
      return {
        ok: true as const,
        tokens: { ...rest, mustChangePassword: profile?.mustChangePassword ?? false },
      };
    });

    if (!outcome.ok) {
      // Catat kegagalan di transaksi terpisah yang PASTI commit.
      await this.prisma.forTenant(tenantId, (tx) =>
        writeAudit(tx, tenantId, this.meta(m, outcome.userId), [
          {
            action: 'login_failed',
            resourceType: 'session',
            outcome: 'denied',
            details: { reason: outcome.reason },
          },
        ]),
      );
      throw challengeFailed();
    }
    return outcome.tokens;
  }

  async refresh(refreshToken: string, m: RequestMeta): Promise<SessionTokens> {
    const parsed = parseToken(refreshToken, 'sr1');
    if (!parsed) throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir', 401);
    const r = await this.prisma.forTenant(parsed.tenantId, async (tx) => {
      const result = await this.sessions.rotate(tx, parsed);
      if (!result.ok && result.reason === 'reuse') {
        const s = await tx.authSession.findUnique({ where: { id: parsed.id }, select: { userId: true } });
        await writeAudit(tx, parsed.tenantId, this.meta(m, s?.userId ?? null), [
          {
            action: 'session_revoked',
            resourceType: 'session',
            resourceId: parsed.id,
            outcome: 'denied',
            details: { reason: 'refresh_reuse' },
          },
        ]);
      }
      return result;
    });
    if (!r.ok) throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir', 401);
    return r.tokens;
  }

  private async createSession(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    mfaVerified: boolean,
    m: RequestMeta,
  ) {
    const idleMinutes = await readTenantSetting(tx, 'session.idle_minutes');
    return this.sessions.create(tx, {
      tenantId,
      userId,
      mfaVerified,
      idleMinutes,
      ip: m.ip,
      userAgent: m.userAgent,
    });
  }
}
