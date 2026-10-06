import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { hasReason } from './rme';

/**
 * K15 · Paket layanan khusus (hemodialisis, kemoterapi, antenatal): jadwal sesi/siklus, daftar kelengkapan formulir
 * dan tindakan per sesi (dengan hak isi per profesi), gerbang lab pra-tindakan (ikuti = tunda sesi, override =
 * alasan wajib tercatat), dan alur mulai → selesai sesi. Keputusan fase 3 no. 18: mekanisme paket + kelengkapan.
 */

export type PackageKind = 'hemodialisis' | 'kemoterapi' | 'anc';

export type SessionStatus = 'selesai' | 'hari-ini' | 'berlangsung' | 'terjadwal' | 'ditunda';

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  selesai: 'Selesai',
  'hari-ini': 'Hari ini',
  berlangsung: 'Berlangsung',
  terjadwal: 'Terjadwal',
  ditunda: 'Ditunda',
};

export interface PackageSession {
  n: number;
  /** Tanggal `YYYY-MM-DD`. */
  date: string;
  status: SessionStatus;
  note: string;
}

export interface PackageItem {
  id: string;
  label: string;
  /** Profesi yang menandai selesai; kosong = semua PPA paket. */
  roles: readonly SystemRoleCode[];
  done: { by: string; at: string } | null;
}

export interface LabGate {
  name: string;
  value: number;
  unit: string;
  /** Ambang minimum protokol RS (contoh). */
  min: number;
}

export interface CarePackage {
  id: string;
  kind: PackageKind;
  title: string;
  encounterId: string;
  patientId: string;
  protocol: string;
  /** "Siklus 4 dari 12", "Sesi HD ke-38". */
  cycleLabel: string;
  sessions: PackageSession[];
  items: PackageItem[];
  labGates: LabGate[];
  /** Label aksi utama sesi hari ini. */
  startLabel: string;
  finishLabel: string;
}

export function missingItems(items: readonly PackageItem[]): PackageItem[] {
  return items.filter((i) => !i.done);
}

export function labFailures(gates: readonly LabGate[]): LabGate[] {
  return gates.filter((g) => g.value < g.min);
}

export function formatLabValue(v: number): string {
  return v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

export type GateDecision = { kind: 'override'; reason: string; by: string; at: string } | null;

/** Gerbang mulai sesi: semua kelengkapan selesai dan gerbang lab lolos atau di-override beralasan. */
export function startBlocker(
  pkg: Pick<CarePackage, 'items' | 'labGates'>,
  decision: GateDecision,
): string | null {
  const missing = missingItems(pkg.items);
  if (missing.length > 0) return `Lengkapi dulu: ${missing.map((m) => m.label).join('; ')}.`;
  if (labFailures(pkg.labGates).length > 0 && !(decision && hasReason(decision.reason))) {
    return 'Hasil lab di bawah ambang protokol: tunda sesi atau lanjut dengan alasan klinis.';
  }
  return null;
}

/** Hak menandai satu butir kelengkapan. Null = boleh. */
export function markBlocker(item: PackageItem, role: string | null): string | null {
  if (item.done) return 'Sudah selesai.';
  if (item.roles.length > 0 && !item.roles.some((r) => r === role)) {
    return `Diisi oleh ${item.roles.map((r) => SYSTEM_ROLES[r]).join(', ')}.`;
  }
  return null;
}

export function todaySession(sessions: readonly PackageSession[]): PackageSession | undefined {
  return sessions.find((s) => s.status === 'hari-ini' || s.status === 'berlangsung');
}

/** Ubah status sesi hari ini (sesi lain tidak berubah). */
export function setTodayStatus(
  sessions: readonly PackageSession[],
  status: SessionStatus,
  note: string,
): PackageSession[] {
  return sessions.map((s) =>
    s.status === 'hari-ini' || s.status === 'berlangsung' ? { ...s, status, note } : s,
  );
}

export function progressLabel(sessions: readonly PackageSession[]): string {
  const done = sessions.filter((s) => s.status === 'selesai').length;
  return `${done} dari ${sessions.length} sesi di jadwal ini selesai`;
}
