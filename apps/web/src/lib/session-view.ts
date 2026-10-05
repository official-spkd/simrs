import type { PinUnavailableReason, TenantKind } from '@simrs/shared';

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
  /** Boleh mendaftarkan PIN di posisi ini (dihitung API dari aturan + pengaturan RS); `reason` bila tidak. */
  pin?: { available: boolean; reason: PinUnavailableReason | null };
}

interface MeLike {
  user: { id: string; username: string; displayName: string; mustChangePassword: boolean };
  tenant: { code: string; name: string; kind: TenantKind };
  mfa: { enrolled: boolean; sessionVerified: boolean };
  role: { code: string; name: string } | null;
  unit: { id: string; name: string } | null;
  permissions: ReadonlyArray<{ resource: string; action: string }>;
  session?: { quickLogin: boolean };
  pin?: { available: boolean; reason: PinUnavailableReason | null };
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
    pin: me.pin ?? { available: false, reason: null },
  };
}

/**
 * Posisi sesi ini boleh mendaftarkan PIN masuk cepat. Dihitung API (`/auth/me`): sesi penuh di RS, peran layanan yang
 * diizinkan pengaturan RS, PIN tidak dimatikan RS, dan posisi terikat unit. API tetap menegakkan saat mendaftar.
 */
export function canRegisterPin(s: Pick<SessionView, 'pin'>): boolean {
  return s.pin?.available ?? false;
}

/** Teks penjelasan bila PIN tidak tersedia untuk posisi ini. */
export function pinUnavailableText(
  reason: PinUnavailableReason | null | undefined,
  roleName: string | null | undefined,
): string {
  switch (reason) {
    case 'quick_session':
      return 'Anda sedang masuk dengan PIN. Untuk mendaftarkan atau mengganti PIN, keluar lalu masuk dengan kata sandi dan kode verifikasi.';
    case 'platform':
      return 'PIN masuk cepat tidak tersedia untuk akun operator platform.';
    case 'disabled':
      return 'PIN masuk cepat dinonaktifkan oleh RS ini.';
    case 'no_position':
      return 'Pilih posisi kerja lebih dulu.';
    case 'no_unit':
      return 'PIN hanya untuk posisi yang terikat ke unit kerja. Ganti posisi ke posisi berunit lebih dulu.';
    default:
      return `Posisi ${roleName ?? 'ini'} tidak bisa memakai PIN masuk cepat di RS ini; masuk dengan kata sandi dan kode verifikasi.`;
  }
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
