/**
 * PIN masuk cepat (docs/05 §1: "login cepat (PIN 6 digit) hanya di perangkat terdaftar dalam unit, sesi pendek").
 * PIN terikat ke satu akun × satu perangkat (peramban) × satu posisi berunit, didaftarkan dari login penuh
 * (sandi + kode verifikasi). Angka-angka di bawah adalah keputusan ADR-0024; batas yang sama dijaga CHECK database.
 */
export const PIN_LENGTH = 6;
/** Salah berturut-turut per perangkat; percobaan ke-5 yang salah mencabut PIN → wajib login penuh. */
export const PIN_MAX_ATTEMPTS = 5;
/** Umur pendaftaran PIN di satu perangkat; setelah itu daftar ulang dari login penuh. */
export const PIN_DEVICE_DAYS = 30;
/** Pendaftaran PIN aktif per akun. */
export const PIN_MAX_DEVICES_PER_USER = 5;
/** Akun ber-PIN yang diingat satu peramban (komputer bersama di unit); yang tertua dilupakan lebih dulu. */
export const PIN_MAX_ACCOUNTS_PER_BROWSER = 8;
/** Sesi dari PIN: maksimal 2 jam dan idle 5 menit (terminal bersama di unit sibuk). */
export const PIN_SESSION_HOURS = 2;
export const PIN_IDLE_MINUTES = 5;

/**
 * Peran yang boleh masuk cepat dengan PIN: petugas layanan yang bergantian memakai komputer unit. Peran sensitif
 * (admin, keuangan, rekam medis, audit, privasi, manajemen; docs/05 §1), peran buatan RS, dan operator platform
 * selalu lewat sandi + kode verifikasi.
 */
export const PIN_LOGIN_ROLES = [
  'dokter',
  'dokter_residen',
  'perawat',
  'bidan',
  'apoteker',
  'analis_lab',
  'radiografer',
  'petugas_pendaftaran',
] as const;

export function pinAllowedForRole(roleCode: string | null | undefined): boolean {
  return !!roleCode && (PIN_LOGIN_ROLES as readonly string[]).includes(roleCode);
}

/** PIN populer yang tidak tertangkap aturan pola (cermin, pola papan angka, deret loncat). */
const COMMON_PINS = new Set([
  '123321',
  '159753',
  '159357',
  '753951',
  '147258',
  '258369',
  '369258',
  '147852',
  '147369',
  '789456',
  '852456',
  '102030',
  '010203',
  '135790',
  '246810',
  '098765',
  '000123',
  '123000',
  '520131',
]);

/** Alasan PIN ditolak (teks untuk pengguna); null = boleh dipakai. */
export function pinProblem(pin: string, ctx: { username?: string } = {}): string | null {
  if (!/^\d{6}$/.test(pin)) return 'PIN harus 6 digit angka.';
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => x - (d[i] ?? 0));
  if (steps.every((s) => s === 0)) return 'PIN tidak boleh angka yang sama semua.';
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return 'PIN tidak boleh angka berurutan.';
  }
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin) || /^(\d)\1(\d)\2(\d)\3$/.test(pin)) {
    return 'PIN tidak boleh pola berulang.';
  }
  if (COMMON_PINS.has(pin)) return 'PIN terlalu mudah ditebak.';
  if (ctx.username?.includes(pin)) return 'PIN tidak boleh bagian dari NIP atau nama pengguna.';
  return null;
}
