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
  patient_identifier: 'Identitas pasien',
  patient_match: 'Kandidat RM ganda',
  patient_link: 'Penggabungan RM',
  privacy_consent: 'Persetujuan privasi',
  form_definition: 'Definisi formulir',
  form_response: 'Isian formulir',
  registered_device: 'Perangkat terdaftar (PIN)',
  field_key_rotation: 'Rotasi kunci enkripsi',
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

export interface ReviewHistoryItem {
  seq: string;
  outcome: string;
  note: string | null;
  reviewedAt: string;
  reviewer: { id: string; displayName: string } | null;
  reviewerRole: string | null;
  effective: boolean;
}

export interface ReviewHistoryRow {
  seq: string;
  effective: boolean;
  /** Status dalam teks (tidak hanya warna): `Berlaku` atau `Digantikan`. */
  status: string;
  decision: string;
  when: string;
  who: string;
  note: string | null;
}

/**
 * Baris riwayat tinjauan temuan, terbaru dulu (urut `seq`, bukan jam tampilan). Penanda "berlaku" dari API
 * (tinjauan terbaru), tidak dihitung ulang di web.
 */
export function reviewHistoryRows(items: readonly ReviewHistoryItem[]): ReviewHistoryRow[] {
  return [...items]
    .sort((a, b) => (BigInt(b.seq) > BigInt(a.seq) ? 1 : BigInt(b.seq) < BigInt(a.seq) ? -1 : 0))
    .map((r) => {
      const label = REVIEW_LABEL[r.outcome] ?? r.outcome;
      return {
        seq: r.seq,
        effective: r.effective,
        status: r.effective ? 'Berlaku' : 'Digantikan',
        decision: label.charAt(0).toUpperCase() + label.slice(1),
        when: formatWaktuServer(r.reviewedAt),
        who: `${r.reviewer?.displayName ?? 'Pengguna tidak dikenal'} · ${roleLabel(r.reviewerRole)}`,
        note: r.note,
      };
    });
}

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
    | 'verifikasi'
    | 'semua',
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

/** Hasil `GET /audit/verify` yang dipakai layar (ADR-0072). */
export interface ChainCheck {
  intact: boolean;
  mode: 'checkpoint' | 'full';
  checked: number;
  firstBrokenSeq: string | null;
  checkpoint: { seq: string; anchoredAt: string } | null;
  anchors: { total: number; verified: number; keyConfigured: boolean };
  issues: Array<{ code: string; seq: string | null; anchoredAt: string | null }>;
  issueCount: number;
  verifiedAt: string;
}

const ISSUE_TEXT: Record<string, (seq: string, at: string) => string> = {
  CHAIN_BROKEN: (seq) => `Ketidakcocokan hash mulai entri #${seq}: entri diubah, disisipkan, atau dihapus.`,
  TRUNCATION_DETECTED: (seq, at) => `Entri #${seq} yang sudah dijangkar${at} hilang: ujung jejak dipotong.`,
  ANCHOR_MISMATCH: (seq, at) =>
    `Entri #${seq} berbeda dari jangkarnya${at}: jejak dipotong lalu ditambah, atau ditulis ulang.`,
  ANCHOR_TAMPERED: (seq) => `Jangkar #${seq} tidak sah (tanda tangan tidak cocok): catatan jangkar diubah.`,
  ANCHOR_KEY_UNKNOWN: (seq) =>
    `Jangkar #${seq} ditandatangani kunci lain (rotasi kunci tanpa kunci lama, atau palsu).`,
};

/**
 * Ringkasan pemeriksaan keutuhan untuk banner layar Audit: judul, kalimat utama, dan satu baris per temuan
 * (urut seq; paling banyak yang dikirim API, sisanya disebut jumlahnya).
 */
export function chainCheckSummary(
  c: ChainCheck,
  jam: (iso: string) => string,
): { level: 'success' | 'critical'; title: string; text: string; lines: string[] } {
  const scope =
    c.mode === 'checkpoint' && c.checkpoint
      ? ` sejak titik periksa #${c.checkpoint.seq} (jangkar ${formatTanggalWaktu(c.checkpoint.anchoredAt)})`
      : ' (pemeriksaan penuh)';
  const anchors = !c.anchors.keyConfigured
    ? ' Kunci jangkar belum dipasang: pemotongan entri terakhir tidak bisa dideteksi.'
    : c.anchors.total > 0
      ? ` ${c.anchors.verified.toLocaleString('id-ID')} jangkar cocok.`
      : '';
  if (c.intact) {
    return {
      level: 'success',
      title: 'Rantai utuh',
      text: `${c.checked.toLocaleString('id-ID')} entri diperiksa pukul ${jam(c.verifiedAt)}${scope}; tidak ada yang diubah atau dihapus.${anchors}`,
      lines: [],
    };
  }
  const lines = c.issues.map((i) => {
    const at = i.anchoredAt ? ` (${formatTanggalWaktu(i.anchoredAt)})` : '';
    const text = ISSUE_TEXT[i.code] ?? ((seq: string) => `${i.code} di #${seq}.`);
    return text(i.seq ?? '?', at);
  });
  if (c.issueCount > c.issues.length) lines.push(`… dan ${c.issueCount - c.issues.length} temuan lain.`);
  return {
    level: 'critical',
    title: 'Rantai rusak',
    text: `Diperiksa pukul ${jam(c.verifiedAt)}${scope}. Laporkan ke tim keamanan; jangan ubah data.`,
    lines,
  };
}
