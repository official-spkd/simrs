import { z } from 'zod';
import { COMPONENTS, type ComponentCode } from './components';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM');

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
