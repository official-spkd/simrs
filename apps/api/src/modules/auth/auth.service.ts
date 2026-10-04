import { Inject, Injectable } from '@nestjs/common';
import { readTenantSetting, resolveTenantByCode, resolveTenantByHost, type TenantTx } from '@simrs/db';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { enqueueOutbox } from '@simrs/db';
import {
  AppError,
  AUTH_BACKUP_CODE_OPERATION,
  BACKUP_CODE_MAX_SENDS,
  type BackupCodeChannel,
  type LoginInput,
  maskPhone,
  type MfaVerifyInput,
  newId,
  type SessionTokens,
  TRUSTED_DEVICE_HOURS,
} from '@simrs/shared';
import {
  decryptField,
  dummyPasswordHash,
  encryptField,
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
  | ({ status: 'mfa_enrollment_required'; mustChangePassword: boolean } & SessionTokens)
  /** Perangkat tepercaya yang masih berlaku: langkah MFA dilewati. */
  | ({ status: 'authenticated'; mustChangePassword: boolean } & SessionTokens);

export interface TrustedDeviceGrant {
  token: string;
  expiresAt: string;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
/** Jeda minimum antar-kiriman kode cadangan untuk satu tantangan. */
const BACKUP_CODE_GAP_MS = 30_000;

/** `rina@rs.go.id` → `r•••@rs.go.id`. */
const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

/** Bandingkan kode 6 digit secara waktu-konstan. */
const codeMatches = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

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
        const trusted = await this.trustedDevice(tx, tenantId, user.id, input.trustedDeviceToken);
        if (trusted) {
          await this.repo.touchTrustedDevice(tx, trusted);
          const tokens = await this.createSession(tx, tenantId, user.id, true, m);
          await writeAudit(tx, tenantId, this.meta(m, user.id), [
            {
              action: 'login',
              resourceType: 'session',
              resourceId: tokens.sessionId,
              details: { mfa: 'trusted_device', trustedDeviceId: trusted },
            },
          ]);
          const { sessionId: _s, ...rest } = tokens;
          return { status: 'authenticated', mustChangePassword: user.mustChangePassword, ...rest };
        }
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
  ): Promise<SessionTokens & { mustChangePassword: boolean; trustedDevice: TrustedDeviceGrant | null }> {
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
      // Kode cadangan (WhatsApp/email) bila pernah dikirim untuk tantangan ini; selain itu TOTP aplikasi.
      const otp = ch.otpEnc
        ? decryptField(ch.otpEnc, { keyB64: this.env.FIELD_ENCRYPTION_KEY, tenantId, purpose: 'login_otp' })
        : null;
      const viaBackup = otp !== null && codeMatches(otp, input.code);
      const factor = viaBackup ? null : await this.repo.findActiveFactor(tx, ch.userId, true);
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
        !viaBackup &&
        (!factor || !v.ok || v.step === undefined || !(await this.repo.markFactorUsed(tx, factor.id, v.step)))
      ) {
        await this.repo.failChallenge(tx, ch.id, CHALLENGE_MAX_ATTEMPTS);
        return { ok: false as const, userId: ch.userId, reason: 'bad_totp' };
      }
      if (!(await this.repo.consumeChallenge(tx, ch.id))) {
        return { ok: false as const, userId: ch.userId, reason: 'challenge_reused' };
      }
      const profile = await this.repo.findUserProfile(tx, ch.userId);
      const tokens = await this.createSession(tx, tenantId, ch.userId, true, m);
      const trustedDevice = input.trustDevice ? await this.trustDevice(tx, tenantId, ch.userId, m) : null;
      await writeAudit(tx, tenantId, this.meta(m, ch.userId), [
        {
          action: 'login',
          resourceType: 'session',
          resourceId: tokens.sessionId,
          details: {
            mfa: viaBackup ? `backup_${ch.otpChannel}` : 'totp',
            ...(trustedDevice ? { trustedDeviceId: trustedDevice.id } : {}),
          },
        },
      ]);
      const { sessionId: _s, ...rest } = tokens;
      return {
        ok: true as const,
        tokens: {
          ...rest,
          mustChangePassword: profile?.mustChangePassword ?? false,
          trustedDevice: trustedDevice
            ? { token: trustedDevice.token, expiresAt: trustedDevice.expiresAt }
            : null,
        },
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

  /**
   * Kirim kode cadangan 6 digit ke WhatsApp/email akun (mockup Login: "Tidak punya akses aplikasi?"). Kode baru
   * menggantikan yang lama, disimpan terenkripsi di tantangan, dikirim worker lewat outbox (payload ID saja), dan
   * berbagi batas 5 percobaan dengan TOTP. Maks. 3 kiriman per tantangan, jeda 30 detik.
   */
  async sendBackupCode(
    input: { challengeToken: string; channel: BackupCodeChannel },
    m: RequestMeta,
  ): Promise<{ channel: BackupCodeChannel; sentTo: string; sentAt: string }> {
    const parsed = parseToken(input.challengeToken, 'sc1');
    if (!parsed) throw challengeFailed();
    const tenantId = parsed.tenantId;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const ch = await this.repo.findChallenge(tx, parsed.id);
      if (
        !ch ||
        ch.consumedAt ||
        ch.expiresAt <= new Date() ||
        !secretMatches(parsed.secret, ch.secretHash)
      ) {
        throw challengeFailed();
      }
      const contact = await this.repo.findUserContact(tx, ch.userId);
      let sentTo: string | null = null;
      if (input.channel === 'whatsapp' && contact?.phoneEnc) {
        sentTo = maskPhone(
          decryptField(contact.phoneEnc, {
            keyB64: this.env.FIELD_ENCRYPTION_KEY,
            tenantId,
            purpose: 'staff_phone',
          }),
        );
      } else if (input.channel === 'email' && contact?.email) {
        sentTo = maskEmail(contact.email);
      }
      if (!sentTo) {
        throw new AppError(
          'VALIDATION_FAILED',
          input.channel === 'whatsapp'
            ? 'Nomor WhatsApp belum terdaftar di akun ini. Hubungi admin SIM RS.'
            : 'Email belum terdaftar di akun ini. Hubungi admin SIM RS.',
          400,
        );
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const sends = await this.repo.setChallengeOtp(tx, ch.id, {
        otpEnc: encryptField(code, { keyB64: this.env.FIELD_ENCRYPTION_KEY, tenantId, purpose: 'login_otp' }),
        channel: input.channel,
        maxSends: BACKUP_CODE_MAX_SENDS,
        minGapMs: BACKUP_CODE_GAP_MS,
      });
      if (sends === null) {
        throw new AppError(
          'RATE_LIMITED',
          `Tunggu 30 detik sebelum meminta kode lagi (maks. ${BACKUP_CODE_MAX_SENDS} kali per login).`,
          429,
        );
      }
      await enqueueOutbox(tx, tenantId, {
        target: input.channel,
        operation: AUTH_BACKUP_CODE_OPERATION,
        idempotencyKey: `login-otp:${ch.id}:${sends}`,
        payload: { challengeId: ch.id },
      });
      await writeAudit(tx, tenantId, this.meta(m, ch.userId), [
        {
          action: 'update',
          resourceType: 'login_challenge',
          resourceId: ch.id,
          details: { backupCode: input.channel, sends },
        },
      ]);
      return { channel: input.channel, sentTo, sentAt: new Date().toISOString() };
    });
  }

  /** ID perangkat tepercaya bila token sah untuk akun ini (selain itu null; tidak pernah melempar). */
  private async trustedDevice(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    token: string | undefined,
  ): Promise<string | null> {
    const parsed = token ? parseToken(token, 'st1') : null;
    if (!parsed || parsed.tenantId !== tenantId) return null;
    const td = await this.repo.findTrustedDevice(tx, parsed.id);
    if (!td || td.userId !== userId || td.revokedAt || td.expiresAt <= new Date()) return null;
    return secretMatches(parsed.secret, td.tokenHash) ? td.id : null;
  }

  private async trustDevice(tx: TenantTx, tenantId: string, userId: string, m: RequestMeta) {
    const id = newId();
    const t = issueToken('st1', tenantId, id);
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_HOURS * 3_600_000);
    await this.repo.createTrustedDevice(tx, {
      id,
      tenantId,
      userId,
      tokenHash: t.hash,
      userAgent: m.userAgent?.slice(0, 200) ?? null,
      expiresAt,
    });
    return { id, token: t.token, expiresAt: expiresAt.toISOString() };
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
