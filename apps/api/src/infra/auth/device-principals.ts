import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@simrs/db';
import { DEVICE_PRINCIPAL_KINDS, type DevicePrincipalKind, devicePermissions } from '@simrs/shared';
import type { DevicePrincipal } from '../../common/request-context';
import { PrismaService } from '../prisma.service';
import { bearerToken, type ParsedToken, parseToken, secretMatches } from './session-tokens';

/** Penanda pakai ditulis paling sering sekali per 5 menit per perangkat (bukan setiap permintaan TV). */
const LAST_USED_RESOLUTION_MS = 5 * 60_000;

export interface AuthenticatedDevice extends DevicePrincipal {
  tenantId: string;
  name: string;
  unitId: string;
}

/** Token `dv1` dari header Authorization, atau null (termasuk bila yang dikirim token jenis lain). */
export function deviceToken(authorization: string | undefined): ParsedToken | null {
  const raw = bearerToken(authorization);
  return raw ? parseToken(raw, 'dv1') : null;
}

/**
 * ADR-0027 · Validasi kredensial prinsipal perangkat (anjungan/TV). Setiap permintaan diperiksa di database:
 * jenis prinsipal, sudah mendaftar, belum dicabut, belum kedaluwarsa, dan rahasia cocok (waktu-konstan). Tanpa sesi
 * terpisah: pencabutan oleh admin berlaku di permintaan berikutnya.
 */
@Injectable()
export class DevicePrincipals {
  constructor(private readonly prisma: PrismaService) {}

  authenticate(token: ParsedToken): Promise<AuthenticatedDevice | null> {
    return this.prisma.forTenant(token.tenantId, (tx) => this.validate(tx, token));
  }

  private async validate(tx: TenantTx, token: ParsedToken): Promise<AuthenticatedDevice | null> {
    const d = await tx.registeredDevice.findFirst({
      where: { id: token.id, kind: { in: [...DEVICE_PRINCIPAL_KINDS] } },
      select: {
        id: true,
        kind: true,
        name: true,
        unitId: true,
        tokenHash: true,
        enrolledAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });
    const now = new Date();
    if (!d || !d.unitId || !d.enrolledAt || d.revokedAt || d.expiresAt <= now) return null;
    if (!secretMatches(token.secret, d.tokenHash)) return null;
    if (!d.lastUsedAt || now.getTime() - d.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await tx.registeredDevice.updateMany({
        where: { id: d.id, revokedAt: null },
        data: { lastUsedAt: now },
      });
    }
    const kind = d.kind as DevicePrincipalKind;
    return {
      id: d.id,
      tenantId: token.tenantId,
      kind,
      name: d.name,
      unitId: d.unitId,
      permissions: devicePermissions(kind),
    };
  }
}
