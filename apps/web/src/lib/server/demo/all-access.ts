import 'server-only';
import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { cookies, headers } from 'next/headers';
import { ALL_ACCESS_USERNAME } from '../../demo/personas';
import { PATH_HEADER } from '../../request-path';
import { actingRoleFor, screenForPath } from '../../screens';
import type { SessionView } from '../../session-view';
import { webEnv } from '../web-env';
import { loadPresentationAccounts } from './accounts';

/**
 * Posisi Superadmin demo (ADR-0023 keputusan 10, permintaan pemilik produk 6 Okt 2026): satu akun presentasi yang di
 * mode presentasi membuka semua layar registri tanpa ganti posisi.
 *
 * Gagal aman:
 * - hanya bila `APP_ENV=local` DAN `DATA_SOURCE=demo`; di luar itu fungsi ini tidak membaca apa pun dan sesi tidak
 *   berubah sedikit pun;
 * - akun dikenali dari data yang tidak bisa dipalsukan klien: nama pengguna + RS dari `/auth/me` (API) harus sama
 *   dengan entri bertanda `allAccess` di berkas kredensial lokal (`.local/demo-accounts.json`, ditulis CLI lokal);
 * - API tidak tahu apa pun tentang tanda ini: di API akun itu akun biasa berperan `manajemen` (hanya-baca), RBAC/ABAC
 *   tidak berubah. Yang berubah hanya UI ber-data dummy (layar `demo`, menu, Server Action demo).
 */

/** Cookie pilihan "Bertindak sebagai" (bukan rahasia; hanya dibaca untuk sesi Superadmin demo yang terverifikasi). */
export function actingRoleCookieName(secure: boolean): string {
  return `${secure ? '__Host-' : ''}simrs_demo_bertindak`;
}

/** Kode peran RS yang dikenal, atau null (nilai cookie kiriman klien tidak dipercaya mentah-mentah). */
export function parseActingRole(value: string | null | undefined): SystemRoleCode | null {
  return value && Object.hasOwn(SYSTEM_ROLES, value) ? (value as SystemRoleCode) : null;
}

/** Sesi ini milik akun Superadmin demo di mode presentasi? Selain itu selalu false (tanpa membaca berkas). */
export async function isAllAccessAccount(s: Pick<SessionView, 'user' | 'tenant'>): Promise<boolean> {
  if (webEnv().dataSource !== 'demo') return false;
  if (s.tenant.kind !== 'hospital' || s.user.username !== ALL_ACCESS_USERNAME) return false;
  const file = await loadPresentationAccounts();
  return (
    !!file &&
    file.tenantCode === s.tenant.code &&
    file.accounts.some((a) => a.username === s.user.username && a.allAccess === true)
  );
}

/**
 * Terapkan posisi Superadmin demo ke sesi (dipanggil `getSession` hanya di mode presentasi). `role` menjadi posisi
 * yang dibawakan di layar permintaan ini (pilihan presenter bila layar memakainya, selain itu pemakai pertama layar),
 * sehingga gerbang posisi yang sudah ada di halaman dan Server Action (co-sign hanya DPJP, TTE dokter, triase, dst.)
 * tetap berlaku apa adanya untuk posisi itu. Server Action dikirim ke URL halamannya, jadi layar yang sama dipakai.
 */
export async function withDemoAllAccess(s: SessionView): Promise<SessionView> {
  if (!s.role || !(await isAllAccessAccount(s))) return s;
  const store = await cookies();
  const preferredRole = parseActingRole(store.get(actingRoleCookieName(webEnv().secureCookies))?.value);
  const path = (await headers()).get(PATH_HEADER) ?? '/';
  const code = actingRoleFor(screenForPath(path), preferredRole, s.role.code);
  const role =
    code && code !== s.role.code ? { code, name: SYSTEM_ROLES[code as SystemRoleCode] ?? code } : s.role;
  return { ...s, role, demoAllAccess: { baseRole: s.role, preferredRole } };
}

/**
 * Simpan pilihan "Bertindak sebagai" (null = hapus, kembali ke bawaan per layar). Hanya dari Server Action, dan
 * pemanggil wajib sudah memastikan sesi Superadmin demo (`demoAllAccess`). 12 jam, httpOnly, SameSite=Lax.
 */
export async function writeActingRole(role: SystemRoleCode | null): Promise<void> {
  const env = webEnv();
  const store = await cookies();
  const expires = role ? new Date(Date.now() + 12 * 3_600_000) : new Date(0);
  store.set(actingRoleCookieName(env.secureCookies), role ?? '', {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}
