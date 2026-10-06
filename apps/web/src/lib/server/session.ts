import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { PATH_HEADER } from '../request-path';
import { loginUrl } from '../safe-path';
import { canReadGuide, isSuperadmin, nextLoginStep, type SessionView, toSessionView } from '../session-view';
import { api } from './api';
import { ApiError } from './api-core';
import { withDemoAllAccess } from './demo/all-access';
import { meSchema } from './schemas';
import { webEnv } from './web-env';

/**
 * Sesi saat ini menurut API (`/auth/me`), sekali per render (React cache). `null` bila belum login atau
 * sesi sudah berakhir/dicabut. Galat lain (API mati) dilempar ke error boundary, bukan dianggap logout.
 * Mode presentasi saja: akun Superadmin demo mendapat posisi per layar (`withDemoAllAccess`, ADR-0023 keputusan 10).
 */
export const getSession = cache(async (): Promise<SessionView | null> => {
  let view: SessionView;
  try {
    view = toSessionView(await api('/api/v1/auth/me', { schema: meSchema }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
  return webEnv().dataSource === 'demo' ? withDemoAllAccess(view) : view;
});

async function currentPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? '/';
}

/**
 * Wajib dipanggil di SETIAP halaman staf (bukan hanya layout: layout tidak dirender ulang saat navigasi dan
 * tidak menghentikan halaman anaknya). Sesi harus lengkap: MFA terverifikasi, sandi sudah diganti, unit dipilih.
 */
export async function requireSession(): Promise<SessionView> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect(loginUrl(await currentPath()));
  return s;
}

/**
 * Panduan sistem (`/superadmin/panduan`): operator platform, atau Superadmin demo hanya di mode presentasi
 * (`canReadGuide`). Selain itu 404.
 */
export async function requireGuideReader(): Promise<SessionView> {
  const s = await requireSession();
  if (!canReadGuide(s, webEnv().dataSource)) notFound();
  return s;
}

/** Area superadmin platform: selain operator platform, halaman ini "tidak ada" (404, tidak membocorkan rute). */
export async function requireSuperadmin(): Promise<SessionView> {
  const s = await requireSession();
  if (!isSuperadmin(s)) notFound();
  return s;
}
