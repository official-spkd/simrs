import { Inject, Injectable } from '@nestjs/common';
import { lockTenantScope, readTenantSetting, resolveTenantByHost, type TenantTx } from '@simrs/db';
import {
  AppError,
  newId,
  PIN_DEVICE_DAYS,
  PIN_IDLE_MINUTES,
  PIN_MAX_ATTEMPTS,
  PIN_MAX_DEVICES_PER_USER,
  PIN_SESSION_HOURS,
  pinAllowedForRole,
  type PinLoginFailure,
  type PinLoginInput,
  pinProblem,
  type PinRegisterInput,
  type SessionTokens,
} from '@simrs/shared';
import { dummyPasswordHash, hashPassword, verifyPassword } from '@simrs/shared/node';
import { requestContext } from '../../common/request-context';
import { API_ENV, type ApiEnv } from '../../config/env';
import { type AuditMeta, writeAudit } from '../../infra/audit-writer';
import { revokePinDevices } from '../../infra/auth/pin-devices';
import { SessionStore } from '../../infra/auth/session-store';
import { issueToken, type ParsedToken, parseToken, secretMatches } from '../../infra/auth/session-tokens';
import { PrismaService } from '../../infra/prisma.service';
import { TenantDb } from '../../infra/tenant-db';
import { AuthRepository } from './auth.repository';
import type { RequestMeta } from './auth.service';
import { pinBlock, pinSecret } from './pin';

const MESSAGES: Record<Exclude<PinLoginFailure, 'wrong'>, string> = {
  revoked:
    'PIN di perangkat ini sudah tidak berlaku. Masuk dengan kata sandi dan kode verifikasi, lalu daftarkan PIN lagi bila perlu.',
  unknown:
    'Perangkat ini tidak dikenali untuk masuk dengan PIN. Masuk dengan kata sandi dan kode verifikasi.',
  not_allowed:
    'Akun ini sedang tidak bisa masuk dengan PIN (akun terkunci atau nonaktif, atau posisinya tidak berlaku). Masuk dengan kata sandi.',
};

/** 401 masuk dengan PIN; `details.pin` memberi tahu web apakah token perangkat perlu dilupakan. */
function pinFailed(kind: PinLoginFailure, remaining?: number): AppError {
  if (kind === 'wrong') {
    return new AppError(
      'UNAUTHENTICATED',
      `PIN salah. Sisa ${remaining} kali percobaan sebelum PIN di perangkat ini dinonaktifkan.`,
      401,
      { pin: kind, remaining },
    );
  }
  return new AppError('UNAUTHENTICATED', MESSAGES[kind], 401, { pin: kind });
}

type PinDeviceRow = Awaited<ReturnType<AuthRepository['findPinDevices']>>[number];

/**
 * P02 · PIN masuk cepat per perangkat terdaftar (docs/05 §1, ADR-0024).
 * - Daftar: dari login penuh (bukan sesi PIN), sandi saat ini wajib, hanya posisi layanan berunit, maks. 5 per akun.
 * - Masuk: token perangkat (cookie httpOnly) + PIN; satu percobaan dicadangkan dan di-commit sebelum PIN diperiksa;
 *   salah ke-5 mencabut PIN. Sesi PIN pendek (2 jam, idle 5 menit) dan terkunci ke posisi pendaftaran.
 * - Setiap daftar, pakai, gagal, dan cabut tercatat di audit.
 */
@Injectable()
export class PinService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
    private readonly db: TenantDb,
    private readonly repo: AuthRepository,
    private readonly sessions: SessionStore,
  ) {}

  private meta(m: RequestMeta, actorUserId: string | null, actorRole: string | null = null): AuditMeta {
    return { actorUserId, actorRole, ip: m.ip, userAgent: m.userAgent, requestId: m.requestId };
  }

  /** Token `sd1` yang formatnya sah; di produksi hanya untuk RS pada subdomain permintaan ini. */
  private async parseDeviceToken(token: string, host: string | null): Promise<ParsedToken | null> {
    const parsed = parseToken(token, 'sd1');
    if (!parsed) return null;
    if (this.env.APP_ENV === 'production') {
      const hostTenant = host ? await resolveTenantByHost(this.prisma.client, host) : null;
      if (hostTenant !== parsed.tenantId) return null;
    }
    return parsed;
  }

  // ------------------------------------------------------------------------------------------------------
  // Publik: layar masuk di perangkat ber-PIN
  // ------------------------------------------------------------------------------------------------------

  /**
   * Akun yang bisa masuk dengan PIN di peramban ini (pilihan di layar masuk), urut sesuai token. Token palsu,
   * dicabut, kedaluwarsa, atau yang posisinya tidak berlaku lagi dilewati tanpa galat.
   */
  async accounts(
    tokens: string[],
    m: RequestMeta,
  ): Promise<Array<{ id: string; displayName: string; roleName: string; unitName: string | null }>> {
    const parsed = (await Promise.all(tokens.map((t) => this.parseDeviceToken(t, m.host)))).filter(
      (p): p is ParsedToken => p !== null,
    );
    const byTenant = new Map<string, ParsedToken[]>();
    for (const p of parsed) byTenant.set(p.tenantId, [...(byTenant.get(p.tenantId) ?? []), p]);
    const found = new Map<string, PinDeviceRow>();
    for (const [tenantId, list] of byTenant) {
      const rows = await this.prisma.forTenant(tenantId, (tx) =>
        this.repo.findPinDevices(
          tx,
          list.map((p) => p.id),
        ),
      );
      for (const r of rows) found.set(r.id, r);
    }
    const now = new Date();
    return parsed.flatMap((p) => {
      const d = found.get(p.id);
      if (!d || !secretMatches(p.secret, d.tokenHash)) return [];
      if (d.revokedAt || d.expiresAt <= now || d.failedAttempts >= PIN_MAX_ATTEMPTS || pinBlock(d, now)) {
        return [];
      }
      return [
        {
          id: d.id,
          displayName: d.user.displayName,
          roleName: d.assignment.role.name,
          unitName: d.assignment.unit?.name ?? null,
        },
      ];
    });
  }

  async login(
    input: PinLoginInput,
    m: RequestMeta,
  ): Promise<{ status: 'authenticated'; mustChangePassword: false } & SessionTokens> {
    const token = await this.parseDeviceToken(input.deviceToken, m.host);
    if (!token) {
      // Samakan waktu respons dengan jalur PIN salah.
      await verifyPassword(input.pin, await dummyPasswordHash());
      throw pinFailed('unknown');
    }
    const tenantId = token.tenantId;
    const fail = (tx: TenantTx, d: PinDeviceRow | null, reason: string, extra: object = {}) =>
      writeAudit(tx, tenantId, this.meta(m, d?.userId ?? null), [
        {
          action: 'login_failed',
          resourceType: 'session',
          outcome: 'denied',
          details: { method: 'pin', reason, ...(d ? { deviceId: d.id } : {}), ...extra },
        },
      ]);

    // 1. Token + kelayakan, lalu cadangkan satu percobaan. Di-commit sebelum PIN diperiksa (juga audit gagal).
    const pre = await this.prisma.forTenant(tenantId, async (tx) => {
      const [d] = await this.repo.findPinDevices(tx, [token.id]);
      if (!d || !secretMatches(token.secret, d.tokenHash)) {
        await fail(tx, null, 'unknown_device');
        return { kind: 'unknown' as const };
      }
      const now = new Date();
      if (d.revokedAt || d.expiresAt <= now) {
        await fail(tx, d, d.revokedAt ? 'pin_revoked' : 'pin_expired');
        return { kind: 'revoked' as const };
      }
      const block = pinBlock(d, now);
      if (block) {
        if (block === 'assignment_ended') await revokePinDevices(tx, { id: d.id }, 'assignment_ended', null);
        await fail(tx, d, block);
        return { kind: block === 'assignment_ended' ? ('revoked' as const) : ('not_allowed' as const) };
      }
      const attempt = await this.repo.reservePinAttempt(tx, d.id, PIN_MAX_ATTEMPTS);
      if (attempt === null) {
        await fail(tx, d, 'pin_revoked');
        return { kind: 'revoked' as const };
      }
      return { kind: 'ok' as const, d, attempt };
    });
    if (pre.kind !== 'ok') {
      if (pre.kind === 'unknown') await verifyPassword(input.pin, await dummyPasswordHash());
      throw pinFailed(pre.kind);
    }
    const { d, attempt } = pre;

    // 2. Periksa PIN di luar transaksi (argon2id lambat; koneksi tidak ditahan).
    const ok = await verifyPassword(
      pinSecret(this.env.FIELD_HASH_KEY, { tenantId, deviceId: d.id, userId: d.userId }, input.pin),
      d.pinHash,
    );
    if (!ok) {
      const revoked = attempt >= PIN_MAX_ATTEMPTS;
      await this.prisma.forTenant(tenantId, async (tx) => {
        if (revoked) await revokePinDevices(tx, { id: d.id }, 'too_many_attempts', null);
        await fail(tx, d, 'bad_pin', { attempt, revoked });
      });
      if (revoked) {
        throw new AppError(
          'UNAUTHENTICATED',
          `PIN salah ${PIN_MAX_ATTEMPTS} kali. PIN di perangkat ini dinonaktifkan; masuk dengan kata sandi dan kode verifikasi, lalu daftarkan PIN lagi.`,
          401,
          { pin: 'revoked' satisfies PinLoginFailure },
        );
      }
      throw pinFailed('wrong', PIN_MAX_ATTEMPTS - attempt);
    }

    // 3. PIN benar: sesi pendek di posisi pendaftaran PIN.
    const result = await this.prisma.forTenant(tenantId, async (tx) => {
      if (!(await this.repo.markPinUsed(tx, d.id))) return null;
      await this.repo.recordSuccessfulLogin(tx, d.userId);
      const tenantIdle = await readTenantSetting(tx, 'session.idle_minutes');
      const tokens = await this.sessions.create(tx, {
        tenantId,
        userId: d.userId,
        mfaVerified: true,
        idleMinutes: Math.min(PIN_IDLE_MINUTES, tenantIdle),
        ttlHours: PIN_SESSION_HOURS,
        pin: { deviceId: d.id, assignment: { id: d.assignmentId, unitId: d.assignment.unitId } },
        ip: m.ip,
        userAgent: m.userAgent,
      });
      await writeAudit(tx, tenantId, this.meta(m, d.userId, d.assignment.role.code), [
        {
          action: 'login',
          resourceType: 'session',
          resourceId: tokens.sessionId,
          details: { method: 'pin', deviceId: d.id },
        },
      ]);
      const { sessionId: _s, ...rest } = tokens;
      return rest;
    });
    if (!result) {
      await this.prisma.forTenant(tenantId, (tx) => fail(tx, d, 'pin_revoked'));
      throw pinFailed('revoked');
    }
    return { status: 'authenticated', mustChangePassword: false, ...result };
  }

  // ------------------------------------------------------------------------------------------------------
  // Sesi penuh: perangkat ber-PIN milik akun ini
  // ------------------------------------------------------------------------------------------------------

  private current() {
    const actor = requestContext.getStore()?.actor;
    if (!actor?.userId || !actor.sessionId) {
      throw new AppError('UNAUTHENTICATED', 'Endpoint ini membutuhkan login', 401);
    }
    return { userId: actor.userId, sessionId: actor.sessionId, deviceId: actor.deviceId ?? null };
  }

  async list() {
    const { userId, deviceId } = this.current();
    const rows = await this.repo.listActivePinDevices(this.db.tx(), userId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      roleName: r.assignment?.role.name ?? '',
      unitName: r.assignment?.unit?.name ?? null,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      /** Sesi ini dibuka dengan PIN perangkat ini. */
      current: r.id === deviceId,
    }));
  }

  /**
   * Daftarkan perangkat ini untuk PIN, untuk posisi sesi saat ini. Token `sd1` hanya dikembalikan di respons ini
   * (web menyimpannya di cookie httpOnly peramban); yang disimpan hanya hash token dan hash PIN berlada.
   */
  async register(input: PinRegisterInput) {
    const { userId, sessionId, deviceId } = this.current();
    if (deviceId) {
      throw new AppError(
        'FORBIDDEN',
        'PIN hanya bisa didaftarkan setelah masuk dengan kata sandi dan kode verifikasi.',
        403,
      );
    }
    const tx = this.db.tx();
    const tenantId = this.db.tenantId();
    const profile = await this.repo.findUserProfile(tx, userId);
    if (!profile) throw new AppError('UNAUTHENTICATED', 'Sesi tidak valid', 401);
    if (profile.tenant.kind !== 'hospital') {
      throw new AppError('FORBIDDEN', 'PIN masuk cepat tidak tersedia untuk akun operator platform.', 403);
    }
    const session = await tx.authSession.findUnique({
      where: { id: sessionId },
      select: {
        assignment: {
          select: {
            id: true,
            unitId: true,
            validFrom: true,
            validUntil: true,
            role: { select: { code: true, name: true, active: true } },
            unit: { select: { name: true, active: true } },
          },
        },
      },
    });
    const a = session?.assignment;
    const now = new Date();
    if (!a || !a.role.active || a.validFrom > now || (a.validUntil !== null && a.validUntil <= now)) {
      throw new AppError('CONFLICT', 'Pilih posisi kerja lebih dulu.', 409);
    }
    if (!pinAllowedForRole(a.role.code)) {
      throw new AppError(
        'FORBIDDEN',
        `Posisi ${a.role.name} tidak bisa memakai PIN masuk cepat; peran ini wajib masuk dengan kata sandi dan kode verifikasi.`,
        403,
      );
    }
    if (!a.unitId || !a.unit?.active) {
      throw new AppError('VALIDATION_FAILED', 'PIN hanya untuk posisi yang terikat ke unit kerja.', 400);
    }
    const problem = pinProblem(input.pin, { username: profile.username });
    if (problem) throw new AppError('VALIDATION_FAILED', problem, 400, { field: 'pin' });
    const hash = profile.credential?.passwordHash;
    if (!hash || !(await verifyPassword(input.password, hash))) {
      throw new AppError('VALIDATION_FAILED', 'Kata sandi saat ini salah.', 400, { field: 'password' });
    }
    // Kunci per akun: dua pendaftaran serentak tidak bisa sama-sama lolos batas jumlah perangkat.
    await lockTenantScope(tx, `registered_devices:${userId}`);
    if ((await this.repo.listActivePinDevices(tx, userId, now)).length >= PIN_MAX_DEVICES_PER_USER) {
      throw new AppError(
        'CONFLICT',
        `Maksimal ${PIN_MAX_DEVICES_PER_USER} perangkat ber-PIN per akun. Hapus perangkat yang tidak dipakai lagi.`,
        409,
      );
    }
    const id = newId();
    const t = issueToken('sd1', tenantId, id);
    const expiresAt = new Date(now.getTime() + PIN_DEVICE_DAYS * 86_400_000);
    await this.repo.createPinDevice(tx, {
      id,
      tenantId,
      userId,
      assignmentId: a.id,
      name: input.name,
      tokenHash: t.hash,
      pinHash: await hashPassword(
        pinSecret(this.env.FIELD_HASH_KEY, { tenantId, deviceId: id, userId }, input.pin),
      ),
      userAgent: requestContext.getStore()?.userAgent?.slice(0, 200) ?? null,
      // Waktu daftar eksplisit: CHECK database membatasi masa berlaku terhadap kolom ini.
      createdAt: now,
      expiresAt,
    });
    return {
      id,
      token: t.token,
      name: input.name,
      roleCode: a.role.code,
      roleName: a.role.name,
      unitId: a.unitId,
      unitName: a.unit.name,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Hapus PIN di salah satu perangkat milik akun ini; sesi PIN dari perangkat itu ikut berakhir. */
  async revoke(id: string) {
    const { userId } = this.current();
    const tx = this.db.tx();
    const d = await tx.registeredDevice.findFirst({
      where: { id, kind: 'staff_pin' },
      select: { userId: true, revokedAt: true },
    });
    if (!d || d.userId !== userId || d.revokedAt) {
      throw new AppError('NOT_FOUND', 'Perangkat ber-PIN tidak ditemukan', 404);
    }
    await revokePinDevices(tx, { id }, 'user_removed', userId);
    return { id, revoked: true };
  }
}
