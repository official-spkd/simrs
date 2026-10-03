import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import { newId } from '@simrs/shared';

/**
 * P02 · Query identitas. Menerima transaksi dari pemanggil karena alur login berjalan sebelum ada
 * transaksi permintaan (tenant baru diketahui dari kode RS/host).
 */
@Injectable()
export class AuthRepository {
  /** Cari pengguna by username di tenant aktif (RLS) beserta hash dan faktor MFA aktif terkonfirmasi. */
  findLoginCandidate(tx: TenantTx, username: string) {
    return tx.user.findFirst({
      where: { username },
      select: {
        id: true,
        username: true,
        status: true,
        lockedUntil: true,
        mustChangePassword: true,
        credential: { select: { passwordHash: true } },
        mfaFactors: {
          where: { disabledAt: null, confirmedAt: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  /**
   * Catat gagal login secara atomik: tambah hitungan dan kunci akun bila mencapai batas
   * (satu pernyataan, aman dari balapan permintaan paralel).
   */
  async recordFailedLogin(tx: TenantTx, userId: string, maxAttempts: number, lockMinutes: number) {
    const rows = await tx.$queryRaw<Array<{ failed_login_count: number; locked_until: Date | null }>>`
      UPDATE users
      SET failed_login_count = failed_login_count + 1,
          locked_until = CASE
            WHEN failed_login_count + 1 >= ${maxAttempts} THEN now() + make_interval(mins => ${lockMinutes})
            ELSE locked_until END,
          updated_at = now()
      WHERE id = ${userId}::uuid
      RETURNING failed_login_count, locked_until`;
    return rows[0];
  }

  recordSuccessfulLogin(tx: TenantTx, userId: string) {
    return tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: { id: true },
    });
  }

  updatePasswordHash(tx: TenantTx, userId: string, passwordHash: string) {
    return tx.userCredential.update({ where: { userId }, data: { passwordHash } });
  }

  createChallenge(
    tx: TenantTx,
    input: { tenantId: string; userId: string; id: string; secretHash: string; expiresAt: Date },
  ) {
    return tx.loginChallenge.create({ data: input, select: { id: true } });
  }

  findChallenge(tx: TenantTx, id: string) {
    return tx.loginChallenge.findUnique({
      where: { id },
      select: { id: true, userId: true, secretHash: true, expiresAt: true, attempts: true, consumedAt: true },
    });
  }

  /** Tambah percobaan; tantangan yang mencapai batas langsung dihanguskan. */
  async failChallenge(tx: TenantTx, id: string, maxAttempts: number) {
    await tx.$executeRaw`
      UPDATE login_challenges
      SET attempts = attempts + 1,
          consumed_at = CASE WHEN attempts + 1 >= ${maxAttempts} THEN now() ELSE consumed_at END
      WHERE id = ${id}::uuid AND consumed_at IS NULL`;
  }

  /** Sekali pakai: hanya satu permintaan yang bisa mengonsumsi tantangan. */
  async consumeChallenge(tx: TenantTx, id: string): Promise<boolean> {
    const r = await tx.loginChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return r.count === 1;
  }

  findActiveFactor(tx: TenantTx, userId: string, confirmed: boolean) {
    return tx.mfaFactor.findFirst({
      where: { userId, disabledAt: null, confirmedAt: confirmed ? { not: null } : null },
      select: { id: true, secretEnc: true, lastUsedStep: true },
    });
  }

  /** Simpan langkah TOTP terpakai secara bersyarat (anti-replay di bawah permintaan paralel). */
  async markFactorUsed(tx: TenantTx, factorId: string, step: number, confirm = false): Promise<boolean> {
    const r = await tx.mfaFactor.updateMany({
      where: { id: factorId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step, ...(confirm ? { confirmedAt: new Date() } : {}) },
    });
    return r.count === 1;
  }

  /** Ganti faktor tertunda lama (belum dikonfirmasi) dengan yang baru. */
  async replacePendingFactor(tx: TenantTx, tenantId: string, userId: string, secretEnc: string) {
    await tx.mfaFactor.updateMany({
      where: { userId, disabledAt: null, confirmedAt: null },
      data: { disabledAt: new Date() },
    });
    return tx.mfaFactor.create({ data: { id: newId(), tenantId, userId, secretEnc }, select: { id: true } });
  }

  findUserProfile(tx: TenantTx, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        mustChangePassword: true,
        lastLoginAt: true,
        credential: { select: { passwordHash: true } },
        mfaFactors: {
          where: { disabledAt: null, confirmedAt: { not: null } },
          select: { id: true },
          take: 1,
        },
        tenant: { select: { code: true, name: true } },
      },
    });
  }

  markPasswordChanged(tx: TenantTx, userId: string) {
    return tx.user.update({
      where: { id: userId },
      data: { mustChangePassword: false, passwordChangedAt: new Date() },
      select: { id: true },
    });
  }
}
