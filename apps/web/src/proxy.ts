import { type NextRequest, NextResponse } from 'next/server';
import { clientInfo } from '@/lib/client-info';
import { contentSecurityPolicy, NONCE_HEADER, newNonce, responsePolicy } from '@/lib/csp';
import { deviceRouteKind, enrolUrl } from '@/lib/perangkat';
import { PATH_HEADER } from '@/lib/request-path';
import { loginUrl } from '@/lib/safe-path';
import { clearCookies, cookieNames, parseDeviceToken, writeSessionCookies } from '@/lib/server/cookies';
import { refreshSession } from '@/lib/server/refresh';
import { webEnv } from '@/lib/server/web-env';
import { withBasePath } from '@/lib/base-path';

/**
 * Proxy (Next 16, runtime Node) di depan semua halaman:
 * 1. Belum login → alihkan halaman ke /masuk?lanjut=… (pemeriksaan optimistis; penegakan tetap di DAL + API).
 * 2. Cookie akses habis tapi cookie refresh ada → perpanjang sesi sekali (aman untuk permintaan paralel),
 *    teruskan cookie baru ke render permintaan ini, dan simpan di browser.
 * 3. Refresh ditolak (sesi idle/dicabut) → hapus cookie, alihkan ke /masuk dengan alasan "sesi berakhir".
 * Layar perangkat (anjungan `/kiosk`, display `/display`) di mode api tidak memakai sesi staf (ADR-0027): tanpa
 * cookie perangkat → halaman pendaftaran perangkat; dengan cookie → diteruskan (`requireDevice` memeriksanya ke API).
 * 4. CSP ber-nonce per permintaan (ADR-0073): nonce + CSP diteruskan ke render (Next memasang nonce di skripnya)
 *    dan dikirim sebagai header respons.
 * Server Action (POST) tidak dialihkan; setiap action memeriksa sesinya sendiri.
 */

/**
 * Rute yang boleh dibuka tanpa login: verifikasi QR dokumen (publik, tanpa PHI) dan pendaftaran perangkat
 * anjungan/TV dengan kode sekali pakai dari admin (ADR-0027).
 */
const PUBLIC_PREFIXES = ['/masuk', '/verifikasi', '/perangkat'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Path + query asli tanpa parameter internal Next (`_rsc`). */
function originalPath(req: NextRequest): string {
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete('_rsc');
  const qs = params.toString();
  return qs ? `${req.nextUrl.pathname}?${qs}` : req.nextUrl.pathname;
}

/** Header Cookie untuk render permintaan ini setelah cookie sesi diganti/dihapus. */
function cookieHeader(req: NextRequest, set: Record<string, string>, remove: string[] = []): string {
  const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value] as const));
  for (const name of remove) jar.delete(name);
  for (const [name, value] of Object.entries(set)) jar.set(name, value);
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === 'development' });
  const headers = new Headers(req.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set('content-security-policy', csp);
  const res = await sessionProxy(req, headers);
  res.headers.set('Content-Security-Policy', responsePolicy(req.nextUrl.pathname, csp));
  return res;
}

/** Langkah sesi (1–3) di atas; `headers` = header permintaan yang diteruskan ke render. */
async function sessionProxy(req: NextRequest, headers: Headers): Promise<NextResponse> {
  const env = webEnv();
  const names = cookieNames(env.secureCookies);
  const path = originalPath(req);
  headers.set(PATH_HEADER, path);

  const access = req.cookies.get(names.access)?.value;
  const refresh = req.cookies.get(names.refresh)?.value;
  const navigation = req.method === 'GET' || req.method === 'HEAD';
  const protectedPage = !isPublic(req.nextUrl.pathname);

  if (env.dataSource === 'api' && deviceRouteKind(req.nextUrl.pathname)) {
    if (navigation && !parseDeviceToken(req.cookies.get(names.device)?.value)) {
      return NextResponse.redirect(new URL(withBasePath(enrolUrl(path)), req.url));
    }
    return NextResponse.next({ request: { headers } });
  }

  if (!access && refresh) {
    const result = await refreshSession(env.apiBaseUrl, refresh, clientInfo(req.headers));
    if (result.ok) {
      headers.set(
        'cookie',
        cookieHeader(req, {
          [names.access]: result.tokens.accessToken,
          [names.refresh]: result.tokens.refreshToken,
        }),
      );
      const res = NextResponse.next({ request: { headers } });
      writeSessionCookies(res.cookies, result.tokens, env.secureCookies);
      return res;
    }
    if (result.status === 401) {
      headers.set('cookie', cookieHeader(req, {}, [names.access, names.refresh]));
      const res =
        protectedPage && navigation
          ? NextResponse.redirect(new URL(withBasePath(loginUrl(path, 'sesi-berakhir')), req.url))
          : NextResponse.next({ request: { headers } });
      clearCookies(res.cookies, env.secureCookies, ['access', 'refresh']);
      return res;
    }
    // API tidak terjangkau atau sedang membatasi laju: biarkan lewat, halaman menampilkan galatnya.
  } else if (!access && !refresh && protectedPage && navigation) {
    return NextResponse.redirect(new URL(withBasePath(loginUrl(path)), req.url));
  }
  return NextResponse.next({ request: { headers } });
}

/**
 * Hanya aset build Next yang dikecualikan. Pengecualian per ekstensi (`.png`, `.svg`, …) dulu juga melewatkan HALAMAN
 * yang path-nya berakhiran ekstensi itu (mis. `/verifikasi/kode.png`, 404 `/x.png`) sehingga dirender tanpa CSP;
 * aplikasi ini tidak punya folder `public`, jadi tidak ada aset statis lain yang perlu dikecualikan.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
