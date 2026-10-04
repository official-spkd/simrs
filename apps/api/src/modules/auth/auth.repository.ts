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
      select: {
        id: true,
        userId: true,
        secretHash: true,
        expiresAt: true,
        attempts: true,
        consumedAt: true,
        otpEnc: true,
        otpChannel: true,
        otpSends: true,
      },
    });
  }

  /**
   * Simpan kode cadangan baru (menggantikan yang lama) bila tantangan masih terbuka, kiriman belum mencapai batas,
   * dan kiriman terakhir sudah lewat `minGapMs`. Atomik terhadap permintaan bersamaan.
   */
  async setChallengeOtp(
    tx: TenantTx,
    id: string,
    otp: { otpEnc: string; channel: string; maxSends: number; minGapMs: number },
  ): Promise<number | null> {
    const rows = await tx.$queryRaw<Array<{ otp_sends: number }>>`
      UPDATE login_challenges
      SET otp_enc = ${otp.otpEnc}, otp_channel = ${otp.channel}, otp_sent_at = now(), otp_sends = otp_sends + 1
      WHERE id = ${id}::uuid AND consumed_at IS NULL AND expires_at > now()
        AND otp_sends < ${otp.maxSends}
        AND (otp_sent_at IS NULL OR otp_sent_at < now() - make_interval(secs => ${otp.minGapMs / 1000}))
      RETURNING otp_sends`;
    return rows[0]?.otp_sends ?? null;
  }

  findUserContact(tx: TenantTx, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: { email: true, phoneEnc: true, status: true },
    });
  }

  createTrustedDevice(
    tx: TenantTx,
    data: {
      id: string;
      tenantId: string;
      userId: string;
      tokenHash: string;
      userAgent: string | null;
      expiresAt: Date;
    },
  ) {
    return tx.trustedDevice.create({ data, select: { id: true } });
  }

  findTrustedDevice(tx: TenantTx, id: string) {
    return tx.trustedDevice.findUnique({
      where: { id },
      select: { id: true, userId: true, tokenHash: true, expiresAt: true, revokedAt: true },
    });
  }

  touchTrustedDevice(tx: TenantTx, id: string) {
    return tx.trustedDevice.update({ where: { id }, data: { lastUsedAt: new Date() }, select: { id: true } });
  }

  revokeTrustedDevices(tx: TenantTx, userId: string) {
    return tx.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
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
        tenant: { select: { id: true, code: true, name: true, kind: true } },
      },
    });
  }

  // ------------------------------------------------------------------------------------------------------
  // PIN masuk cepat per perangkat (ADR-0024)
  // ------------------------------------------------------------------------------------------------------

  /** PIN perangkat (jenis `staff_pin`) beserta keadaan akun + posisi yang menentukan kelayakannya (`pinBlock`). */
  async findPinDevices(tx: TenantTx, ids: string[]) {
    const rows = await tx.registeredDevice.findMany({
      where: { id: { in: ids }, kind: 'staff_pin' },
      select: {
        id: true,
        userId: true,
        assignmentId: true,
        tokenHash: true,
        pinHash: true,
        failedAttempts: true,
        expiresAt: true,
        revokedAt: true,
        tenant: { select: { kind: true } },
        user: {
          select: {
            displayName: true,
            status: true,
            lockedUntil: true,
            mustChangePassword: true,
            mfaFactors: {
              where: { disabledAt: null, confirmedAt: { not: null } },
              select: { id: true },
              take: 1,
            },
          },
        },
        assignment: {
          select: {
            validFrom: true,
            validUntil: true,
            unitId: true,
            role: { select: { code: true, name: true, active: true } },
            unit: { select: { name: true, active: true } },
          },
        },
      },
    });
    // CHECK `registered_devices_staff_pin` menjamin kolom PIN terisi; di sini hanya dipersempit untuk tipe.
    return rows.flatMap(({ userId, assignmentId, pinHash, user, assignment, ...r }) =>
      userId && assignmentId && pinHash && user && assignment
        ? [{ ...r, userId, assignmentId, pinHash, user, assignment }]
        : [],
    );
  }

  /**
   * Cadangkan satu percobaan SEBELUM PIN diperiksa (atomik, di-commit lebih dulu): tebakan paralel tidak bisa
   * melewati batas. Null bila PIN sudah dicabut, kedaluwarsa, atau percobaannya habis.
   */
  async reservePinAttempt(tx: TenantTx, id: string, maxAttempts: number): Promise<number | null> {
    const rows = await tx.$queryRaw<Array<{ failed_attempts: number }>>`
      UPDATE registered_devices SET failed_attempts = failed_attempts + 1
      WHERE id = ${id}::uuid AND kind = 'staff_pin' AND revoked_at IS NULL AND expires_at > now()
        AND failed_attempts < ${maxAttempts}
      RETURNING failed_attempts`;
    return rows[0]?.failed_attempts ?? null;
  }

  /** PIN benar: hitungan salah kembali 0 + penanda pakai. False bila PIN dicabut di antara pemeriksaan. */
  async markPinUsed(tx: TenantTx, id: string): Promise<boolean> {
    const r = await tx.registeredDevice.updateMany({
      where: { id, revokedAt: null },
      data: { failedAttempts: 0, lastUsedAt: new Date() },
    });
    return r.count === 1;
  }

  createPinDevice(
    tx: TenantTx,
    data: {
      id: string;
      tenantId: string;
      userId: string;
      assignmentId: string;
      name: string;
      tokenHash: string;
      pinHash: string;
      userAgent: string | null;
      createdAt: Date;
      expiresAt: Date;
    },
  ) {
    return tx.registeredDevice.create({ data: { ...data, kind: 'staff_pin' }, select: { id: true } });
  }

  /** PIN perangkat aktif (belum dicabut, belum kedaluwarsa) milik akun, terbaru dulu. */
  listActivePinDevices(tx: TenantTx, userId: string, now = new Date()) {
    return tx.registeredDevice.findMany({
      where: { userId, kind: 'staff_pin', revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        assignment: { select: { role: { select: { name: true } }, unit: { select: { name: true } } } },
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
