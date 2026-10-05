import { readTenantSetting, type TenantTx } from '@simrs/db';
import { type PinPolicy, pinRoleAllowed } from '@simrs/shared';
import { blindIndex } from '@simrs/shared/node';

/**
 * PIN 6 digit hanya punya sejuta kemungkinan, jadi argon2id saja tidak cukup bila hash bocor. PIN dilada dulu
 * dengan HMAC (FIELD_HASH_KEY, per tenant) atas ID perangkat + akun, sehingga hash di database tidak bisa ditebak
 * tanpa kunci dan tidak bisa dipindah ke perangkat/akun/tenant lain.
 */
export function pinSecret(
  hashKeyB64: string,
  ids: { tenantId: string; deviceId: string; userId: string },
  pin: string,
): string {
  return blindIndex(`${ids.deviceId}|${ids.userId}|${pin}`, {
    hashKeyB64,
    tenantId: ids.tenantId,
    purpose: 'login_pin',
  });
}

/** Keadaan akun + posisi yang menentukan apakah PIN boleh dipakai saat ini. */
export interface PinEligibility {
  tenant: { kind: string };
  user: {
    status: string;
    lockedUntil: Date | null;
    mustChangePassword: boolean;
    mfaFactors: unknown[];
  };
  assignment: {
    validFrom: Date;
    validUntil: Date | null;
    unitId: string | null;
    role: { code: string; active: boolean };
    unit: { active: boolean } | null;
  };
}

/** Kebijakan PIN RS ini (pengaturan P12), dibaca di transaksi bertenant. */
export async function readPinPolicy(tx: TenantTx): Promise<PinPolicy> {
  return {
    enabled: await readTenantSetting(tx, 'pin.enabled'),
    allowedRoles: await readTenantSetting(tx, 'pin.allowed_roles'),
  };
}

/**
 * Alasan PIN tidak bisa dipakai sekarang (null = boleh). `assignment_ended` mencabut PIN-nya; selain itu hanya
 * menolak (mis. akun terkunci sementara, atau RS mematikan PIN / mempersempit perannya lewat pengaturan).
 */
export type PinBlock =
  | 'platform'
  | 'pin_disabled'
  | 'user_inactive'
  | 'locked'
  | 'account_incomplete'
  | 'assignment_ended'
  | 'role_not_allowed'
  | 'unit_inactive';

export function pinBlock(d: PinEligibility, now: Date, policy: PinPolicy): PinBlock | null {
  const a = d.assignment;
  if (d.tenant.kind !== 'hospital') return 'platform';
  if (!policy.enabled) return 'pin_disabled';
  if (d.user.status !== 'active') return 'user_inactive';
  if (d.user.lockedUntil && d.user.lockedUntil > now) return 'locked';
  if (d.user.mfaFactors.length === 0 || d.user.mustChangePassword) return 'account_incomplete';
  if (!a.role.active || a.validFrom > now || (a.validUntil !== null && a.validUntil <= now)) {
    return 'assignment_ended';
  }
  if (!pinRoleAllowed(a.role.code, policy) || !a.unitId) return 'role_not_allowed';
  if (!a.unit?.active) return 'unit_inactive';
  return null;
}
