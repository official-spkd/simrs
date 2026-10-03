import { Inject, Injectable } from '@nestjs/common';
import { activeAssignments, type TenantTx } from '@simrs/db';
import { newId, type SessionTokens } from '@simrs/shared';
import { API_ENV, type ApiEnv } from '../../config/env';
import { issueToken, type ParsedToken, secretMatches } from './session-tokens';

export interface ValidatedSession {
  sessionId: string;
  userId: string;
  mfaVerified: boolean;
  mustChangePassword: boolean;
  /** Peran dari penugasan terpilih yang MASIH berlaku; null bila belum dipilih atau sudah berakhir. */
  roleCode: string | null;
  unitId: string | null;
}

/** Jangan menulis `last_seen_at` lebih sering dari ini (mengurangi tulis per permintaan). */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * P02 · Siklus hidup sesi: buat, validasi token akses, rotasi refresh (dengan deteksi pemakaian ulang), cabut.
 * Semua fungsi menerima transaksi bertenant (RLS) dari pemanggil.
 */
@Injectable()
export class SessionStore {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  private accessTtlMs() {
    return this.env.ACCESS_TOKEN_TTL_MINUTES * 60_000;
  }

  async create(
    tx: TenantTx,
    input: {
      tenantId: string;
      userId: string;
      mfaVerified: boolean;
      idleMinutes: number;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<SessionTokens & { sessionId: string }> {
    const id = newId();
    const now = Date.now();
    const access = issueToken('sa1', input.tenantId, id);
    const refresh = issueToken('sr1', input.tenantId, id);
    const accessExpiresAt = new Date(now + this.accessTtlMs());
    const refreshExpiresAt = new Date(now + this.env.SESSION_TTL_HOURS * 3_600_000);
    // Satu penugasan aktif → langsung dipakai; lebih dari satu → pengguna memilih (POST /auth/assignment).
    const assignments = await activeAssignments(tx, input.userId);
    const only = assignments.length === 1 ? assignments[0] : undefined;
    await tx.authSession.create({
      data: {
        id,
        tenantId: input.tenantId,
        userId: input.userId,
        accessHash: access.hash,
        accessExpiresAt,
        refreshHash: refresh.hash,
        refreshExpiresAt,
        lastSeenAt: new Date(now),
        idleTimeoutMinutes: input.idleMinutes,
        mfaVerified: input.mfaVerified,
        assignmentId: only?.id ?? null,
        unitId: only?.unitId ?? null,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
    return {
      sessionId: id,
      accessToken: access.token,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  /** Validasi token akses. Sesi idle terlalu lama dicabut di tempat. */
  async validateAccess(tx: TenantTx, t: ParsedToken, now = new Date()): Promise<ValidatedSession | null> {
    const s = await tx.authSession.findUnique({
      where: { id: t.id },
      select: {
        id: true,
        userId: true,
        status: true,
        accessHash: true,
        accessExpiresAt: true,
        refreshExpiresAt: true,
        lastSeenAt: true,
        idleTimeoutMinutes: true,
        mfaVerified: true,
        unitId: true,
        user: { select: { status: true, mustChangePassword: true } },
        assignment: {
          select: { validFrom: true, validUntil: true, role: { select: { code: true, active: true } } },
        },
      },
    });
    if (!s || s.status !== 'active' || !secretMatches(t.secret, s.accessHash)) return null;
    if (s.accessExpiresAt <= now || s.refreshExpiresAt <= now) return null;
    if (s.user.status !== 'active') {
      await this.revoke(tx, s.id, 'user_disabled');
      return null;
    }
    if (s.lastSeenAt.getTime() + s.idleTimeoutMinutes * 60_000 <= now.getTime()) {
      await this.revoke(tx, s.id, 'idle_timeout');
      return null;
    }
    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await tx.authSession.update({ where: { id: s.id }, data: { lastSeenAt: now } });
    }
    const a = s.assignment;
    const assignmentValid =
      !!a && a.role.active && a.validFrom <= now && (a.validUntil === null || a.validUntil > now);
    return {
      sessionId: s.id,
      userId: s.userId,
      mfaVerified: s.mfaVerified,
      mustChangePassword: s.user.mustChangePassword,
      roleCode: assignmentValid ? a.role.code : null,
      unitId: assignmentValid ? s.unitId : null,
    };
  }

  /**
   * Rotasi refresh token. Token lama yang dipakai lagi (setelah dirotasi) dianggap dicuri: sesi dicabut.
   * Pembaruan bersyarat `refresh_hash = <lama>` mencegah dua rotasi paralel dari token yang sama.
   */
  async rotate(
    tx: TenantTx,
    t: ParsedToken,
    now = new Date(),
  ): Promise<
    | { ok: true; tokens: SessionTokens; userId: string }
    | { ok: false; reason: 'invalid' | 'reuse' | 'expired' }
  > {
    const s = await tx.authSession.findUnique({
      where: { id: t.id },
      select: {
        id: true,
        userId: true,
        status: true,
        refreshHash: true,
        previousRefreshHash: true,
        refreshExpiresAt: true,
        lastSeenAt: true,
        idleTimeoutMinutes: true,
        user: { select: { status: true } },
      },
    });
    if (!s || s.status !== 'active') return { ok: false, reason: 'invalid' };
    if (secretMatches(t.secret, s.previousRefreshHash)) {
      await this.revoke(tx, s.id, 'refresh_reuse');
      return { ok: false, reason: 'reuse' };
    }
    if (!secretMatches(t.secret, s.refreshHash)) return { ok: false, reason: 'invalid' };
    const idle = s.lastSeenAt.getTime() + s.idleTimeoutMinutes * 60_000 <= now.getTime();
    if (s.refreshExpiresAt <= now || idle || s.user.status !== 'active') {
      await this.revoke(tx, s.id, idle ? 'idle_timeout' : 'expired');
      return { ok: false, reason: 'expired' };
    }
    const access = issueToken('sa1', t.tenantId, s.id);
    const refresh = issueToken('sr1', t.tenantId, s.id);
    const accessExpiresAt = new Date(
      Math.min(now.getTime() + this.accessTtlMs(), s.refreshExpiresAt.getTime()),
    );
    const updated = await tx.authSession.updateMany({
      where: { id: s.id, refreshHash: s.refreshHash, status: 'active' },
      data: {
        accessHash: access.hash,
        accessExpiresAt,
        previousRefreshHash: s.refreshHash,
        refreshHash: refresh.hash,
        lastSeenAt: now,
      },
    });
    if (updated.count !== 1) {
      await this.revoke(tx, s.id, 'refresh_reuse');
      return { ok: false, reason: 'reuse' };
    }
    return {
      ok: true,
      userId: s.userId,
      tokens: {
        accessToken: access.token,
        accessExpiresAt: accessExpiresAt.toISOString(),
        refreshToken: refresh.token,
        refreshExpiresAt: s.refreshExpiresAt.toISOString(),
      },
    };
  }

  async revoke(tx: TenantTx, sessionId: string, reason: string): Promise<void> {
    await tx.authSession.updateMany({
      where: { id: sessionId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(
    tx: TenantTx,
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const r = await tx.authSession.updateMany({
      where: { userId, status: 'active', ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  /** Pilih penugasan untuk sesi (harus milik pengguna dan masih berlaku; diperiksa pemanggil). */
  async selectAssignment(
    tx: TenantTx,
    sessionId: string,
    assignmentId: string,
    unitId: string | null,
  ): Promise<void> {
    await tx.authSession.update({ where: { id: sessionId }, data: { assignmentId, unitId } });
  }

  async markMfaVerified(tx: TenantTx, sessionId: string): Promise<void> {
    await tx.authSession.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  }
}
