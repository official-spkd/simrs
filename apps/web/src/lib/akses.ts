import { formatJam, formatTanggal, jakartaParts, type PermissionScope } from '@simrs/shared';
import type { ChipTone } from '@simrs/ui';

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

export interface AccountFlags {
  status: string;
  locked: boolean;
  dormant: boolean;
  neverLoggedIn: boolean;
}

/** Status akun untuk reviu akses; selalu berupa teks (tidak hanya warna). */
export function accountStatus(u: AccountFlags): { label: string; tone: ChipTone } {
  if (u.status !== 'active') return { label: 'Nonaktif', tone: 'neutral' };
  if (u.locked) return { label: 'Dikunci', tone: 'danger' };
  if (u.dormant) return { label: 'Dormant', tone: 'warning' };
  if (u.neverLoggedIn) return { label: 'Belum login', tone: 'info' };
  return { label: 'Aktif', tone: 'success' };
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
