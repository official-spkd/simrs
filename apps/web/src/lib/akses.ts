import { formatJam, formatTanggal, jakartaParts, type PermissionScope } from '@simrs/shared';
import type { ChipTone, IconName } from '@simrs/ui';

/** Logika murni layar Akses (/sistem/akses), terpisah dari komponen agar bisa diuji. */

const DAY = 86_400_000;

function jakartaDayNumber(input: Date | string): number {
  const p = jakartaParts(input);
  return Date.UTC(p.year, p.month - 1, p.day) / DAY;
}

/** `hari ini 07.02` · `kemarin 21.40` · `5 hari lalu` · `Sen, 5 Okt 2026` · `belum pernah` (zona Asia/Jakarta). */
export function formatLastLogin(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'belum pernah';
  const days = jakartaDayNumber(now) - jakartaDayNumber(iso);
  if (days <= 0) return `hari ini ${formatJam(iso)}`;
  if (days === 1) return `kemarin ${formatJam(iso)}`;
  if (days < 60) return `${days} hari lalu`;
  return formatTanggal(iso);
}

/**
 * Ringkasan user agent untuk daftar perangkat tepercaya: peramban + sistem operasi (`Chrome di Windows`), tanpa
 * versi. Tidak dikenali → `Peramban tidak dikenal`.
 */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (!browser) return os ? `Peramban di ${os}` : 'Peramban tidak dikenal';
  return os ? `${browser} di ${os}` : browser;
}

export interface AccountFlags {
  status: string;
  /** Sudah punya kata sandi; belum = tidak bisa masuk sampai admin mereset sandinya (mis. staf seed). */
  activated: boolean;
  locked: boolean;
  dormant: boolean;
  neverLoggedIn: boolean;
}

export interface AccountStatus {
  label: string;
  tone: ChipTone;
  icon: IconName;
}

/**
 * Status akun untuk reviu akses; selalu teks + ikon (tidak hanya warna). "Belum diaktifkan" mendahului dormant dan
 * belum login karena butuh tindakan admin (Reset kata sandi), bukan sekadar menunggu pemilik akun.
 */
export function accountStatus(u: AccountFlags): AccountStatus {
  if (u.status !== 'active') return { label: 'Nonaktif', tone: 'neutral', icon: 'x' };
  if (!u.activated) return { label: 'Belum diaktifkan', tone: 'warning', icon: 'clock' };
  if (u.locked) return { label: 'Dikunci', tone: 'danger', icon: 'alert' };
  if (u.dormant) return { label: 'Dormant', tone: 'warning', icon: 'history' };
  if (u.neverLoggedIn) return { label: 'Belum login', tone: 'info', icon: 'info' };
  return { label: 'Aktif', tone: 'success', icon: 'check' };
}

/** Petunjuk untuk akun yang belum diaktifkan (panel detail layar Akses). */
export const NOT_ACTIVATED_HINT =
  'Akun ini belum punya kata sandi, jadi belum bisa masuk. Pilih "Reset kata sandi" untuk membuat sandi sementara (tampil sekali); saat login pertama pemiliknya wajib mendaftarkan MFA dan mengganti sandi.';

/** Pilihan filter status di layar Akses: nilai URL (Indonesia) → nilai `status` API `/iam/users`. */
export const STATUS_FILTERS = [
  { value: 'aktif', label: 'Aktif', api: 'active' },
  { value: 'belum-diaktifkan', label: 'Belum diaktifkan', api: 'not_activated' },
  { value: 'nonaktif', label: 'Nonaktif', api: 'disabled' },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

/** Nilai `status` untuk API dari filter URL, atau undefined bila tidak dikenal/kosong. */
export function statusFilterParam(value: string | undefined): string | undefined {
  return STATUS_FILTERS.find((f) => f.value === value)?.api;
}

export const ACTION_LABEL: Record<string, string> = {
  read: 'Lihat',
  write: 'Tulis',
  export: 'Ekspor',
  review: 'Tinjau',
  merge: 'Gabung',
  publish: 'Terbitkan',
  correct: 'Koreksi',
  print: 'Cetak',
  use: 'Pakai',
};

export const SCOPE_LABEL: Record<PermissionScope, string> = {
  all: 'Semua',
  unit: 'Unit',
  relationship: 'Relasi',
};

/** Klik sel matriks: mulai dari lingkup tersempit, lalu melebar, lalu dicabut. */
export function nextScope(current: PermissionScope | null): PermissionScope | null {
  if (current === null) return 'relationship';
  if (current === 'relationship') return 'unit';
  if (current === 'unit') return 'all';
  return null;
}

export type GrantMap = Record<string, PermissionScope>;

export function toGrantMap(
  grants: ReadonlyArray<{ resource: string; action: string; scope: PermissionScope }>,
): GrantMap {
  return Object.fromEntries(grants.map((g) => [`${g.resource}|${g.action}`, g.scope]));
}

export function fromGrantMap(
  map: GrantMap,
): Array<{ resource: string; action: string; scope: PermissionScope }> {
  return Object.entries(map)
    .map(([key, scope]) => {
      const [resource = '', action = ''] = key.split('|');
      return { resource, action, scope };
    })
    .sort((a, b) => `${a.resource}.${a.action}`.localeCompare(`${b.resource}.${b.action}`));
}

/** Jumlah sel yang berubah dibanding matriks tersimpan. */
export function countChanges(base: GrantMap, current: GrantMap): number {
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  let n = 0;
  for (const k of keys) if (base[k] !== current[k]) n++;
  return n;
}

export type AksesParams = Partial<
  Record<'q' | 'peran' | 'status' | 'kursor' | 'pengguna' | 'matriks', string>
>;

/** Tautan /sistem/akses yang mempertahankan filter; nilai `undefined` menghapus parameter. */
export function aksesHref(current: AksesParams, patch: AksesParams): string {
  const merged: AksesParams = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/sistem/akses?${qs}` : '/sistem/akses';
}
