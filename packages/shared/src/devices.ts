import { z } from 'zod';
import { DEVICE_GRANTS, DEVICE_KINDS, type DeviceKind, permissionKey } from './authz';

/**
 * ADR-0027 · Prinsipal perangkat: anjungan mandiri (F05) dan display TV antrean (F04) masuk sebagai PERANGKAT terdaftar
 * per unit, bukan sebagai akun staf. Baris `registered_devices` jenis `kiosk`/`queue_display` (tabel yang sama dengan
 * PIN 10c-2, ADR-0024). Jenis, label, dan izin tetap bersumber dari katalog izin (`DEVICE_KINDS`, `DEVICE_GRANTS`
 * di `authz.ts`, potongan 0a); angka di bawah dijaga juga oleh CHECK database.
 */
export const DEVICE_PRINCIPAL_KINDS = Object.keys(DEVICE_KINDS) as DeviceKind[];
export type DevicePrincipalKind = DeviceKind;

export const DEVICE_KIND_LABEL: Record<DevicePrincipalKind, string> = DEVICE_KINDS;

/**
 * Izin TETAP per jenis perangkat (`sumber.aksi` dari `DEVICE_GRANTS`; lingkupnya = unit perangkat). Bukan bagian
 * matriks peran (tidak bisa diberikan ke peran manusia dan tidak bisa diubah RS); perangkat juga tidak pernah mendapat
 * izin manusia.
 */
export type DevicePermission = 'kiosk.use' | 'queue.display.read';

export function devicePermissions(kind: DevicePrincipalKind): readonly DevicePermission[] {
  return DEVICE_GRANTS[kind].map(([resource, action]) => permissionKey(resource, action) as DevicePermission);
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

export const devicePrincipalKindSchema = z.enum(DEVICE_PRINCIPAL_KINDS as [DeviceKind, ...DeviceKind[]]);

/** Admin mendaftarkan perangkat baru (layar Akses → Perangkat). */
export const createDeviceSchema = z
  .object({
    kind: devicePrincipalKindSchema,
    name: z
      .string()
      .trim()
      .min(3, 'Nama perangkat minimal 3 karakter')
      .max(60, 'Nama perangkat maksimal 60 karakter'),
    unitId: z.uuid('Pilih unit'),
    /** Display: papan antrean yang ditampilkan (opsional; bisa menyusul saat papan dibuat). */
    queueDisplayId: z.uuid('Papan antrean tidak valid').optional(),
  })
  .refine((v) => v.kind === 'queue_display' || v.queueDisplayId === undefined, {
    message: 'Papan antrean hanya untuk display',
    path: ['queueDisplayId'],
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
  queueDisplay: z.object({ id: z.uuid(), name: z.string() }).nullable(),
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
  queueDisplay: z.object({ id: z.uuid(), name: z.string() }).nullable(),
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
  queue_display: '/display/antrean',
};
