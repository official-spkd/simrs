import { PIN_DEVICE_DAYS, PIN_MAX_ACCOUNTS_PER_BROWSER, type SessionTokens } from '@simrs/shared';

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
  /**
   * "Percayai perangkat ini" (12 jam): milik perangkat, bukan sesi, jadi TIDAK ikut dihapus saat keluar. Token
   * hanya berlaku untuk akun yang mencentangnya; API mengabaikannya untuk akun lain.
   */
  trustedDevice: string;
  /**
   * PIN masuk cepat (ADR-0024): token perangkat `sd1` tiap akun yang mendaftarkan PIN di peramban ini (komputer
   * bersama di unit), terbaru dulu. Seperti perangkat tepercaya, milik perangkat: tidak dihapus saat keluar.
   */
  pinDevices: string;
}

export function cookieNames(secure: boolean): CookieNames {
  const p = secure ? '__Host-' : '';
  return {
    access: `${p}simrs_at`,
    refresh: `${p}simrs_rt`,
    challenge: `${p}simrs_mfa`,
    challengeUser: `${p}simrs_mfa_user`,
    trustedDevice: `${p}simrs_td`,
    pinDevices: `${p}simrs_pin`,
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

export function writeTrustedDeviceCookie(
  w: CookieWriter,
  device: { token: string; expiresAt: string },
  secure: boolean,
): void {
  w.set(cookieNames(secure).trustedDevice, device.token, cookieOptions(secure, new Date(device.expiresAt)));
}

const PIN_TOKEN =
  /^sd1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
const PIN_SEPARATOR = '~';

/** ID pendaftaran PIN di dalam token `sd1` (bagian ketiga); null bila bukan token PIN. */
export function pinTokenId(token: string): string | null {
  return PIN_TOKEN.exec(token)?.[1] ?? null;
}

/** Token PIN dari isi cookie: hanya yang berformat sah, tanpa duplikat, maks. sesuai batas peramban. */
export function parsePinTokens(value: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of (value ?? '').split(PIN_SEPARATOR)) {
    const id = pinTokenId(t);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out.slice(0, PIN_MAX_ACCOUNTS_PER_BROWSER);
}

/** Tambah token PIN baru di depan; token terlama dilupakan bila melewati batas peramban. */
export function addPinToken(tokens: string[], token: string): string[] {
  const id = pinTokenId(token);
  return [token, ...tokens.filter((t) => pinTokenId(t) !== id)].slice(0, PIN_MAX_ACCOUNTS_PER_BROWSER);
}

export function removePinTokens(tokens: string[], ids: readonly string[]): string[] {
  return tokens.filter((t) => !ids.includes(pinTokenId(t) ?? ''));
}

/** Simpan daftar token PIN (habis bersama umur maksimum PIN); daftar kosong = cookie dihapus. */
export function writePinTokens(w: CookieWriter, tokens: string[], secure: boolean, now = Date.now()): void {
  const name = cookieNames(secure).pinDevices;
  if (tokens.length === 0) {
    w.set(name, '', cookieOptions(secure, new Date(0)));
    return;
  }
  w.set(
    name,
    tokens.join(PIN_SEPARATOR),
    cookieOptions(secure, new Date(now + PIN_DEVICE_DAYS * 86_400_000)),
  );
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
