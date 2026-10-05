/**
 * Kebijakan kata sandi (docs/05 §1): panjang ≥ 12 (bisa dinaikkan per RS), maks 128, bukan kata sandi umum/bocor,
 * tidak memuat nama pengguna atau kode RS, bukan pola berulang/berurutan. Tanpa aturan "wajib simbol"
 * (NIST SP 800-63B: panjang lebih penting daripada komposisi).
 *
 * Daftar statis di bawah hanya lapis dasar yang selalu berlaku (juga tanpa database). Daftar besar (N teratas kata
 * sandi bocor, mis. Pwned Passwords) diimpor operator ke `ref.breached_passwords` lewat `pnpm db:import-breached` dan
 * diperiksa API saat kata sandi diganti (`isBreachedPassword` di @simrs/db).
 */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwerty123456',
  'qwertyqwerty',
  '123456789012',
  '1234567890123',
  '12345678901234',
  'abcdefghijkl',
  'abc123abc123',
  'iloveyou1234',
  'admin1234567',
  'administrator',
  'administrator1',
  'adminadmin123',
  'welcome12345',
  'letmein12345',
  'rahasia12345',
  'rahasiasekali',
  'katasandi123',
  'katasandi1234',
  'bismillah123',
  'bismillah1234',
  'indonesia123',
  'indonesia1234',
  'jakarta12345',
  'rumahsakit123',
  'rumahsakit1234',
  'simrs1234567',
  'simrs12345678',
  'dokter123456',
  'perawat12345',
  'sayang123456',
  'merdeka12345',
  'p@ssw0rd1234',
  'passw0rd1234',
]);

export type PasswordViolation =
  'too_short' | 'too_long' | 'common' | 'contains_identity' | 'repetitive' | 'sequential';

export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_VIOLATION_MESSAGES: Record<PasswordViolation, string> = {
  too_short: 'Kata sandi terlalu pendek',
  too_long: `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter`,
  common: 'Kata sandi terlalu umum atau pernah bocor',
  contains_identity: 'Kata sandi tidak boleh memuat nama pengguna atau kode RS',
  repetitive: 'Kata sandi tidak boleh berupa karakter yang berulang',
  sequential: 'Kata sandi tidak boleh berupa deret berurutan',
};

function isSequential(s: string): boolean {
  if (s.length < 6) return false;
  const codes = [...s].map((c) => c.charCodeAt(0));
  const diffs = codes.slice(1).map((c, i) => c - (codes[i] ?? 0));
  return diffs.every((d) => d === 1) || diffs.every((d) => d === -1);
}

export function checkPasswordPolicy(
  password: string,
  ctx: { minLength: number; username?: string; tenantCode?: string },
): PasswordViolation[] {
  const v: PasswordViolation[] = [];
  const lower = password.toLowerCase();
  if ([...password].length < ctx.minLength) v.push('too_short');
  if ([...password].length > PASSWORD_MAX_LENGTH) v.push('too_long');
  if (COMMON_PASSWORDS.has(lower)) v.push('common');
  const identities = [ctx.username, ctx.tenantCode]
    .filter((x): x is string => typeof x === 'string' && x.length >= 4)
    .map((x) => x.toLowerCase());
  if (identities.some((id) => lower.includes(id))) v.push('contains_identity');
  if (/^(.)\1+$/.test(password) || /^(.{1,3})\1{3,}$/.test(password)) v.push('repetitive');
  if (isSequential(lower)) v.push('sequential');
  return v;
}
