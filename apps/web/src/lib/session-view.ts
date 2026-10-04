import { pinAllowedForRole, type TenantKind } from '@simrs/shared';

/** DTO sesi untuk render: hanya yang dibutuhkan UI (tanpa token, tanpa email, tanpa ID sesi). */
export interface SessionView {
  user: { id: string; username: string; displayName: string; initials: string };
  tenant: { code: string; name: string; kind: TenantKind };
  role: { code: string; name: string } | null;
  unit: { id: string; name: string } | null;
  /** Izin peran aktif dalam bentuk `sumber.aksi`. Hanya untuk menampilkan menu; API tetap menegakkan. */
  permissions: readonly string[];
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  mustChangePassword: boolean;
  /** Sesi dibuka dengan PIN perangkat (ADR-0024): pendek, posisi terkunci, tidak bisa mendaftarkan PIN. */
  quickLogin?: boolean;
}

interface MeLike {
  user: { id: string; username: string; displayName: string; mustChangePassword: boolean };
  tenant: { code: string; name: string; kind: TenantKind };
  mfa: { enrolled: boolean; sessionVerified: boolean };
  role: { code: string; name: string } | null;
  unit: { id: string; name: string } | null;
  permissions: ReadonlyArray<{ resource: string; action: string }>;
  session?: { quickLogin: boolean };
}

export function toSessionView(me: MeLike): SessionView {
  return {
    user: {
      id: me.user.id,
      username: me.user.username,
      displayName: me.user.displayName,
      initials: initials(me.user.displayName),
    },
    tenant: { code: me.tenant.code, name: me.tenant.name, kind: me.tenant.kind },
    role: me.role,
    unit: me.unit,
    permissions: me.permissions.map((p) => `${p.resource}.${p.action}`),
    mfaEnrolled: me.mfa.enrolled,
    mfaVerified: me.mfa.sessionVerified,
    mustChangePassword: me.user.mustChangePassword,
    quickLogin: me.session?.quickLogin ?? false,
  };
}

/**
 * Posisi sesi ini boleh mendaftarkan PIN masuk cepat (sama dengan aturan API): sesi penuh (bukan sesi PIN) di RS,
 * peran layanan (bukan peran sensitif), dan posisi yang terikat unit kerja.
 */
export function canRegisterPin(s: Pick<SessionView, 'tenant' | 'role' | 'unit' | 'quickLogin'>): boolean {
  return !s.quickLogin && s.tenant.kind === 'hospital' && pinAllowedForRole(s.role?.code) && s.unit !== null;
}

export function can(s: Pick<SessionView, 'permissions'>, resource: string, action: string): boolean {
  return s.permissions.includes(`${resource}.${action}`);
}

/** Operator platform: tenant PLATFORM + izin panduan (peran superadmin_platform). */
export function isSuperadmin(s: Pick<SessionView, 'tenant' | 'permissions'>): boolean {
  return s.tenant.kind === 'platform' && can(s, 'platform.guide', 'read');
}

export type LoginStep = 'akun' | 'verifikasi' | 'daftar-mfa' | 'ganti-sandi' | 'unit' | 'selesai';

/**
 * Langkah login berikutnya, dihitung dari keadaan di server (bukan memori browser), sehingga memuat ulang
 * halaman atau membuka tab baru selalu menampilkan langkah yang benar.
 */
export function nextLoginStep(
  s: Pick<SessionView, 'mfaVerified' | 'mustChangePassword' | 'role'> | null,
  hasChallenge: boolean,
): LoginStep {
  if (!s) return hasChallenge ? 'verifikasi' : 'akun';
  if (!s.mfaVerified) return 'daftar-mfa';
  if (s.mustChangePassword) return 'ganti-sandi';
  if (!s.role) return 'unit';
  return 'selesai';
}

/** Inisial avatar dari nama tampilan, tanpa gelar (dr., S.Kep, Sp.PD). */
export function initials(name: string): string {
  const words = name
    .split(',')[0]
    ?.split(/\s+/)
    .filter((w) => w.length > 0 && !w.endsWith('.') && /\p{L}/u.test(w));
  const letters = (words ?? []).slice(0, 2).map((w) => w.match(/\p{L}/u)?.[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}
