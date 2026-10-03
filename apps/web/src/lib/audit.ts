import {
  AUDIT_ACTION_GROUPS,
  type AuditAction,
  formatTanggalWaktu,
  jakartaParts,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
} from '@simrs/shared';
import type { ChipTone } from '@simrs/ui';

/** Logika murni layar Audit (/sistem/audit), terpisah dari komponen agar bisa diuji. */

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;
const DAY = 86_400_000;

export const RENTANG = {
  'hari-ini': 'Hari ini',
  '7-hari': '7 hari terakhir',
  '30-hari': '30 hari terakhir',
  '90-hari': '90 hari terakhir',
} as const;
export type Rentang = keyof typeof RENTANG;

/** Awal rentang (inklusif): "hari ini" = sejak 00.00 WIB; selain itu n×24 jam ke belakang. */
export function rangeStart(rentang: Rentang, now: Date = new Date()): Date {
  if (rentang === 'hari-ini') {
    const p = jakartaParts(now);
    const mm = String(p.month).padStart(2, '0');
    const dd = String(p.day).padStart(2, '0');
    return new Date(`${p.year}-${mm}-${dd}T00:00:00+07:00`);
  }
  const days = { '7-hari': 7, '30-hari': 30, '90-hari': 90 }[rentang];
  return new Date(now.getTime() - days * DAY);
}

export function rangeDays(rentang: Rentang): number {
  return { 'hari-ini': 1, '7-hari': 7, '30-hari': 30, '90-hari': 90 }[rentang];
}

/** `4 Okt 08.51` (WIB). */
export function formatWaktuSingkat(iso: string): string {
  const p = jakartaParts(iso);
  return `${p.day} ${BULAN[p.month - 1]} ${p.hour}.${p.minute}`;
}

/** `Min, 4 Okt 2026 · 08.51.07` (WIB, dengan detik untuk waktu catat server). */
export function formatWaktuServer(iso: string): string {
  return `${formatTanggalWaktu(iso)}.${iso.slice(17, 19)}`;
}

/** Tanggal WIB `YYYY-MM-DD`. */
export function tanggalWib(now: Date = new Date()): string {
  const p = jakartaParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const GROUP_TONE: Record<keyof typeof AUDIT_ACTION_GROUPS, ChipTone> = {
  baca: 'neutral',
  ubah: 'info',
  cetak: 'neutral',
  akun: 'brand',
  darurat: 'danger',
};

/** Warna chip aksi: penolakan/gagal selalu merah; selebihnya mengikuti kelompoknya. */
export function actionTone(action: string, outcome?: string): ChipTone {
  if (outcome === 'denied' || action === 'login_failed' || action === 'access_denied') return 'danger';
  if (action === 'review' || action === 'sign') return 'success';
  for (const [group, def] of Object.entries(AUDIT_ACTION_GROUPS)) {
    if ((def.actions as readonly string[]).includes(action))
      return GROUP_TONE[group as keyof typeof GROUP_TONE];
  }
  return 'neutral';
}

export const RESOURCE_LABEL: Record<string, string> = {
  user: 'Akun pengguna',
  user_credential: 'Kata sandi akun',
  session: 'Sesi login',
  staff_assignment: 'Penugasan',
  role_permissions: 'Matriks izin',
  patient: 'Pasien',
  break_glass: 'Akses darurat',
  audit_event: 'Jejak audit',
  audit_chain: 'Rantai audit',
  audit_anomaly: 'Temuan anomali',
  tenant_setting: 'Pengaturan RS',
  tenant_module: 'Modul RS',
  facility: 'Faskes',
  unit: 'Unit',
  location: 'Lokasi',
  outbox_message: 'Pesan integrasi',
  'iam.users': 'Kelola pengguna',
  'iam.roles': 'Kelola peran',
  audit: 'Jejak audit',
};

/** Objek yang disentuh, tanpa PHI: label sumber + potongan id. */
export function objectLabel(e: {
  resourceType: string;
  resourceId: string | null;
  patientId: string | null;
}): string {
  const label = RESOURCE_LABEL[e.resourceType] ?? e.resourceType;
  const id = e.patientId ?? e.resourceId;
  return id ? `${label} · ${id.slice(0, 8)}` : label;
}

/** Perangkat ringkas: IP + nama peramban/OS yang dikenali dari user agent. */
export function deviceLabel(ip: string | null, userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const agent = [browser, os].filter(Boolean).join(' · ');
  return [ip, agent || (ua ? 'perangkat lain' : null)].filter(Boolean).join(' · ') || '—';
}

export const FINDING_KIND_LABEL: Record<string, string> = {
  break_glass: 'AKSES DARURAT',
  login_failed: 'GAGAL MASUK BERULANG',
  access_denied: 'AKSES DITOLAK BERULANG',
  night: 'DI LUAR JAM DINAS',
  volume: 'VOLUME TAK WAJAR',
};

export const REVIEW_LABEL: Record<string, string> = {
  sah: 'akses sah',
  perlu_klarifikasi: 'perlu klarifikasi',
};

export type AuditParams = Partial<
  Record<
    | 'rentang'
    | 'jenis'
    | 'peran'
    | 'pasien'
    | 'pengguna'
    | 'kursor'
    | 'kejadian'
    | 'tinjau'
    | 'temuan'
    | 'laporan'
    | 'verifikasi',
    string
  >
>;

/** Tautan /sistem/audit yang mempertahankan filter; nilai `undefined` menghapus parameter. */
export function auditHref(current: AuditParams, patch: AuditParams): string {
  const merged: AuditParams = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/sistem/audit?${qs}` : '/sistem/audit';
}

/** Nama peran untuk tampilan (kode peran sistem → nama); kode lain apa adanya. */
export function roleLabel(code: string | null): string {
  if (!code) return '—';
  return ({ ...SYSTEM_ROLES, ...PLATFORM_ROLES } as Record<string, string>)[code] ?? code;
}

export function actionLabelOf(labels: Record<AuditAction, string>, action: string): string {
  return (labels as Record<string, string>)[action] ?? action;
}
