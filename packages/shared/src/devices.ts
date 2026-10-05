import { z } from 'zod';

/**
 * ADR-0027 · Prinsipal perangkat: anjungan mandiri (F05) dan display TV antrean (F04) masuk sebagai PERANGKAT terdaftar
 * per unit, bukan sebagai akun staf. Baris `registered_devices` jenis `kiosk`/`display` (tabel yang sama dengan PIN
 * 10c-2, ADR-0024). Angka di bawah dijaga juga oleh CHECK database.
 */
export const DEVICE_PRINCIPAL_KINDS = ['kiosk', 'display'] as const;
export type DevicePrincipalKind = (typeof DEVICE_PRINCIPAL_KINDS)[number];

export const DEVICE_KIND_LABEL: Record<DevicePrincipalKind, string> = {
  kiosk: 'Anjungan mandiri',
  display: 'Display antrean',
};

/**
 * Izin TETAP per jenis perangkat. Bukan bagian matriks peran (tidak bisa diberikan ke peran manusia dan tidak bisa
 * diubah RS); perangkat juga tidak pernah mendapat izin manusia.
 * SEMENTARA: string literal sampai katalog izin fase 2 (potongan 0a) mengekspor `kiosk.use` dan `queue.display.read`.
 */
export const DEVICE_PERMISSIONS = {
  kiosk: ['kiosk.use'],
  display: ['queue.display.read'],
} as const satisfies Record<DevicePrincipalKind, readonly string[]>;
export type DevicePermission = (typeof DEVICE_PERMISSIONS)[DevicePrincipalKind][number];

export function devicePermissions(kind: DevicePrincipalKind): readonly DevicePermission[] {
  return DEVICE_PERMISSIONS[kind];
}

/** Kode pendaftaran sekali pakai yang ditampilkan ke admin, berlaku 15 menit. */
export const DEVICE_ENROLMENT_MINUTES = 15;
/** Umur kredensial perangkat setelah didaftarkan; setelahnya admin mendaftarkan ulang. */
export const DEVICE_PRINCIPAL_DAYS = 365;

/** Alfabet Crockford base32 (tanpa I, L, O, U): mudah dibaca dan diketik dari layar admin. */
export const ENROLMENT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 10 karakter = 50 bit; ditampilkan `XXXXX-XXXXX`. */
export const ENROLMENT_CODE_LENGTH = 10;

/**
 * Bentuk baku kode pendaftaran dari ketikan pengguna: huruf besar, tanpa spasi/tanda hubung, huruf yang mirip angka
 * dipetakan seperti Crockford (O→0, I/L→1). `null` bila bukan kode yang sah.
 */
export function normalizeEnrolmentCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== ENROLMENT_CODE_LENGTH) return null;
  for (const ch of code) if (!ENROLMENT_ALPHABET.includes(ch)) return null;
  return code;
}

/** `ABCDE12345` → `ABCDE-12345`. */
export function formatEnrolmentCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export const devicePrincipalKindSchema = z.enum(DEVICE_PRINCIPAL_KINDS);

/** Admin mendaftarkan perangkat baru (layar Akses → Perangkat). */
export const createDeviceSchema = z.object({
  kind: devicePrincipalKindSchema,
  name: z
    .string()
    .trim()
    .min(3, 'Nama perangkat minimal 3 karakter')
    .max(60, 'Nama perangkat maksimal 60 karakter'),
  unitId: z.uuid('Pilih unit'),
});
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;

/** Perangkat menukar kode pendaftaran dengan kredensial (tanpa login staf). */
export const enrolDeviceSchema = z.object({
  /** Kode RS (lokal/staging); produksi memakai subdomain. */
  tenantCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, 'Kode RS tidak valid')
    .optional(),
  code: z.string().trim().min(1, 'Isi kode pendaftaran').max(20, 'Kode pendaftaran tidak valid'),
});
export type EnrolDeviceInput = z.infer<typeof enrolDeviceSchema>;

export const DEVICE_STATUSES = ['pending', 'active', 'expired', 'revoked'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  pending: 'Menunggu pendaftaran',
  active: 'Aktif',
  expired: 'Kedaluwarsa',
  revoked: 'Dicabut',
};

/** Ringkasan perangkat untuk layar admin (tanpa token/hash). */
export const deviceViewSchema = z.object({
  id: z.uuid(),
  kind: devicePrincipalKindSchema,
  name: z.string(),
  unit: z.object({ id: z.uuid(), name: z.string() }),
  status: z.enum(DEVICE_STATUSES),
  createdAt: z.string(),
  expiresAt: z.string(),
  enrolExpiresAt: z.string().nullable(),
  enrolledAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type DeviceView = z.infer<typeof deviceViewSchema>;

/** Jawaban pendaftaran oleh admin: kode hanya ditampilkan sekali. */
export const createdDeviceSchema = z.object({
  device: deviceViewSchema,
  enrolmentCode: z.string(),
  enrolmentExpiresAt: z.string(),
});

/** Identitas perangkat yang sedang memakai layar (`GET /devices/me`). */
export const deviceSelfSchema = z.object({
  id: z.uuid(),
  kind: devicePrincipalKindSchema,
  name: z.string(),
  tenant: z.object({ name: z.string() }),
  unit: z.object({ id: z.uuid(), name: z.string() }),
  permissions: z.array(z.string()),
  expiresAt: z.string(),
});
export type DeviceSelf = z.infer<typeof deviceSelfSchema>;

/** Jawaban pendaftaran oleh perangkat: token `dv1` hanya untuk cookie httpOnly BFF. */
export const enrolledDeviceSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  device: z.object({ id: z.uuid(), kind: devicePrincipalKindSchema, name: z.string() }),
});

/** Halaman awal tiap jenis perangkat di web. */
export const DEVICE_HOME: Record<DevicePrincipalKind, string> = {
  kiosk: '/kiosk',
  display: '/display/antrean',
};
