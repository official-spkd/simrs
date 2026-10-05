import { z } from 'zod';
import { SENSITIVE_ROLES } from './authz';
import { COMPONENTS, type ComponentCode } from './components';
import { BACKUP_CODE_CHANNELS } from './schemas/auth';
import { PIN_LOGIN_ROLES } from './security/pin-policy';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM');
/** Daftar tanpa duplikat. */
const uniqueList = <T extends z.ZodType<string>>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((v) => new Set(v).size === v.length, 'Isi daftar tidak boleh ganda');
const roleCode = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Kode peran tidak valid');

interface SettingDef<T> {
  label: string;
  schema: z.ZodType<T>;
  default: T;
}

function def<T>(label: string, schema: z.ZodType<T>, defaultValue: T): SettingDef<T> {
  return { label, schema, default: defaultValue };
}

/**
 * Batas bawah ambang temuan anomali (P04). Ringkasan harian audit membuang hitungan di bawahnya karena tidak pernah
 * bisa menjadi temuan, apa pun pengaturan RS (ADR-0072). Naikkan/turunkan hanya bersama versi ringkasan.
 */
export const AUDIT_VOLUME_THRESHOLD_MIN = 2;
export const AUDIT_BURST_THRESHOLD_MIN = 2;

/**
 * P12 · Registri pengaturan per RS. Hanya kunci di sini yang boleh disimpan; nilainya divalidasi skemanya.
 * Menambah pengaturan = menambah entri di sini (bukan kolom baru di database).
 */
export const TENANT_SETTINGS = {
  'session.idle_minutes': def('Batas sesi idle (menit)', z.number().int().min(5).max(60), 15),
  'password.min_length': def('Panjang minimum kata sandi', z.number().int().min(12).max(128), 12),
  'login.max_failed_attempts': def(
    'Batas gagal login sebelum akun dikunci',
    z.number().int().min(3).max(10),
    5,
  ),
  'login.lockout_minutes': def('Lama kunci akun (menit)', z.number().int().min(5).max(1440), 15),
  // P02 · Kode cadangan login (ADR-0022): kanal yang boleh dipakai RS ini; kosong = kode cadangan nonaktif.
  'login.backup_code_channels': def(
    'Kanal kode cadangan login bila tidak punya aplikasi autentikator (kosong = nonaktif)',
    uniqueList(z.enum(BACKUP_CODE_CHANNELS), BACKUP_CODE_CHANNELS.length),
    [...BACKUP_CODE_CHANNELS],
  ),
  // Pemegang salah satu peran ini (di posisi mana pun) wajib kode aplikasi autentikator, tanpa kode cadangan.
  'login.totp_only_roles': def(
    'Peran yang wajib kode aplikasi autentikator (tanpa kode cadangan WhatsApp/email)',
    uniqueList(roleCode, 50),
    [...SENSITIVE_ROLES],
  ),
  // P02 · PIN masuk cepat (ADR-0024): bisa dimatikan per RS atau dipersempit ke sebagian peran layanan.
  'pin.enabled': def('PIN masuk cepat di perangkat terdaftar', z.boolean(), true),
  'pin.allowed_roles': def(
    'Peran yang boleh memakai PIN masuk cepat',
    uniqueList(z.enum(PIN_LOGIN_ROLES), PIN_LOGIN_ROLES.length),
    [...PIN_LOGIN_ROLES],
  ),
  'break_glass.duration_minutes': def('Durasi akses darurat (menit)', z.number().int().min(15).max(120), 60),
  'resume.deadline_hours': def('Batas waktu penyelesaian resume (jam)', z.number().int().min(1).max(72), 24),
  'service.hours': def(
    'Jam layanan rawat jalan',
    z
      .strictObject({ open: hhmm, close: hhmm })
      .refine((v) => v.open < v.close, 'Jam buka harus sebelum jam tutup'),
    { open: '07:00', close: '21:00' },
  ),
  'audit.night_hours': def(
    'Jam malam untuk deteksi anomali akses',
    z.strictObject({ start: hhmm, end: hhmm }),
    { start: '22:00', end: '05:00' },
  ),
  'audit.volume_threshold': def(
    'Batas pasien berbeda per pengguna per hari sebelum ditandai anomali',
    z.number().int().min(AUDIT_VOLUME_THRESHOLD_MIN).max(1000),
    50,
  ),
  'audit.burst_threshold': def(
    'Batas gagal login atau akses ditolak per pengguna per hari sebelum ditandai anomali',
    z.number().int().min(AUDIT_BURST_THRESHOLD_MIN).max(100),
    5,
  ),
  // F01–F08 · Front office (fase 2)
  'queue.avg_service_minutes': def(
    'Rata-rata lama layanan per pasien untuk estimasi antrean (menit), bila layanan tidak mengatur sendiri',
    z.number().int().min(1).max(120),
    10,
  ),
  'booking.max_days_ahead': def(
    'Batas hari ke depan untuk booking (juga rentang sesi jadwal yang dibangkitkan)',
    z.number().int().min(1).max(90),
    30,
  ),
  'schedule.jkn_share_percent': def(
    'Porsi kuota JKN bawaan per sesi praktik (%); sisanya non-JKN',
    z.number().int().min(0).max(100),
    80,
  ),
  'kiosk.lookup_rate_per_min': def(
    'Batas pencarian identitas per anjungan per menit (cegah enumerasi)',
    z.number().int().min(1).max(60),
    10,
  ),
  'kiosk.lookup_rate_per_tenant_per_min': def(
    'Batas pencarian identitas semua anjungan RS per menit (cegah enumerasi lewat banyak perangkat)',
    z.number().int().min(1).max(1000),
    60,
  ),
  // F02/F06 · Pengganti no. HP pasien JKN yang kosong/tidak sah: `nohp` tambah antrean dan `noTelp` SEP.
  'bpjs.contact_phone': def(
    'No. telepon RS untuk BPJS bila pasien JKN tidak punya no. HP (kosong = belum diatur)',
    z.union([z.literal(''), z.string().regex(/^0\d{8,13}$/, 'No. telepon diawali 0, 9–14 digit')]),
    '',
  ),
} as const;

export type TenantSettingKey = keyof typeof TENANT_SETTINGS;
export type TenantSettingValue<K extends TenantSettingKey> = (typeof TENANT_SETTINGS)[K]['default'];

export function isTenantSettingKey(key: string): key is TenantSettingKey {
  return Object.hasOwn(TENANT_SETTINGS, key);
}

/** Validasi nilai untuk kunci tertentu. Melempar ZodError bila tidak sesuai. */
export function parseTenantSetting<K extends TenantSettingKey>(
  key: K,
  value: unknown,
): TenantSettingValue<K> {
  return TENANT_SETTINGS[key].schema.parse(value) as TenantSettingValue<K>;
}

/** Modul inti yang tidak boleh dimatikan per RS (tanpanya sistem tidak aman dijalankan). */
export const CORE_MODULES = ['P01', 'P02', 'P03', 'P04', 'P10'] as const satisfies readonly ComponentCode[];

export function isComponentCode(code: string): code is ComponentCode {
  return Object.hasOwn(COMPONENTS, code);
}

/** Bawaan bila RS belum mengatur: komponen tahap MVP aktif, tahap "Lanjut" mati. */
export function defaultModuleEnabled(code: ComponentCode): boolean {
  return COMPONENTS[code].stage.startsWith('MVP');
}
