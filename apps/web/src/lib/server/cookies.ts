import type { SessionTokens } from '@simrs/shared';

/**
 * Cookie sesi BFF (ADR-0013). Token API tidak pernah sampai ke JavaScript browser: semua cookie httpOnly,
 * SameSite=Lax, path /, dan di luar lokal Secure + prefiks `__Host-` (tidak bisa ditimpa subdomain lain).
 * Dipakai proxy dan Server Action, jadi modul ini sengaja tanpa `server-only` dan tanpa API Next.
 */

/** Cookie akses dibuang browser 60 detik sebelum token akses kedaluwarsa, sehingga proxy sempat memperbarui. */
export const ACCESS_COOKIE_MARGIN_MS = 60_000;

export interface CookieNames {
  access: string;
  refresh: string;
  /** Token tantangan MFA (langkah 2 login) dan nama akun yang sedang login, maks 5 menit. */
  challenge: string;
  challengeUser: string;
}

export function cookieNames(secure: boolean): CookieNames {
  const p = secure ? '__Host-' : '';
  return {
    access: `${p}simrs_at`,
    refresh: `${p}simrs_rt`,
    challenge: `${p}simrs_mfa`,
    challengeUser: `${p}simrs_mfa_user`,
  };
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  expires: Date;
}

export interface CookieWriter {
  set(name: string, value: string, options: SessionCookieOptions): unknown;
}

export function cookieOptions(secure: boolean, expires: Date): SessionCookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', expires };
}

export function writeSessionCookies(
  w: CookieWriter,
  tokens: SessionTokens,
  secure: boolean,
  now: number = Date.now(),
): void {
  const names = cookieNames(secure);
  const accessUntil = Math.max(now, Date.parse(tokens.accessExpiresAt) - ACCESS_COOKIE_MARGIN_MS);
  w.set(names.access, tokens.accessToken, cookieOptions(secure, new Date(accessUntil)));
  w.set(names.refresh, tokens.refreshToken, cookieOptions(secure, new Date(tokens.refreshExpiresAt)));
}

export function writeChallengeCookies(
  w: CookieWriter,
  challenge: { token: string; expiresAt: string; username: string },
  secure: boolean,
): void {
  const names = cookieNames(secure);
  const expires = new Date(challenge.expiresAt);
  w.set(names.challenge, challenge.token, cookieOptions(secure, expires));
  w.set(names.challengeUser, challenge.username, cookieOptions(secure, expires));
}

/** Hapus cookie dengan menimpanya (atribut sama, kedaluwarsa di masa lalu). */
export function clearCookies(w: CookieWriter, secure: boolean, which: Array<keyof CookieNames>): void {
  const names = cookieNames(secure);
  for (const key of which) w.set(names[key], '', cookieOptions(secure, new Date(0)));
}

export const ALL_SESSION_COOKIES: Array<keyof CookieNames> = [
  'access',
  'refresh',
  'challenge',
  'challengeUser',
];
