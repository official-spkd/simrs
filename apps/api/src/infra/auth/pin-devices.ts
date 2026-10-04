import type { TenantTx } from '@simrs/db';
import type { PinRevokeReason } from '@simrs/shared';

/**
 * Cabut PIN perangkat yang masih aktif (ADR-0024) dan akhiri sesi yang dibuka dengannya. Dipakai modul auth (hapus
 * perangkat, ganti sandi, salah 5×) dan IAM (reset sandi/MFA, nonaktif, penugasan berakhir, cabut oleh admin).
 * Pencabutan final (trigger database); mengembalikan jumlah PIN yang dicabut.
 */
export async function revokePinDevices(
  tx: TenantTx,
  where: { id?: string; userId?: string; assignmentId?: string },
  reason: PinRevokeReason,
  revokedBy: string | null,
): Promise<number> {
  const rows = await tx.pinDevice.findMany({ where: { ...where, revokedAt: null }, select: { id: true } });
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  const now = new Date();
  const r = await tx.pinDevice.updateMany({
    where: { id: { in: ids }, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason, revokedBy },
  });
  await tx.authSession.updateMany({
    where: { pinDeviceId: { in: ids }, status: 'active' },
    data: { status: 'revoked', revokedAt: now, revokedReason: 'pin_revoked' },
  });
  return r.count;
}
