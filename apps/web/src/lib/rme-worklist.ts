/**
 * K01 · Worklist klinis per posisi (dokter/DPJP, residen, perawat, bidan): pasien saya + tugas tertunda (nilai
 * kritis, co-sign, verifikasi CPPT, tinjau order residen, hasil baru, konsul, obat jatuh tempo, reasesmen, serah
 * terima). Logika murni: urutan prioritas, label tenggat, baca ulang nilai kritis, hak menyelesaikan per posisi.
 */

export type WorklistRole = 'dokter' | 'dokter_residen' | 'perawat' | 'bidan';

const ROLES: readonly WorklistRole[] = ['dokter', 'dokter_residen', 'perawat', 'bidan'];

export function worklistRole(code: string | null | undefined): WorklistRole | null {
  return ROLES.find((r) => r === code) ?? null;
}

export const WORKLIST_ROLE_TITLE: Record<WorklistRole, string> = {
  dokter: 'DPJP',
  dokter_residen: 'Dokter residen (PPDS)',
  perawat: 'Perawat penanggung jawab',
  bidan: 'Bidan penanggung jawab',
};

export type WorklistKind =
  | 'nilai-kritis'
  | 'cosign'
  | 'menunggu-cosign'
  | 'verifikasi'
  | 'review-order'
  | 'hasil-baru'
  | 'konsul'
  | 'resume'
  | 'obat'
  | 'reasesmen'
  | 'askep'
  | 'edukasi'
  | 'serah-terima'
  | 'observasi';

export const WORKLIST_KIND_LABEL: Record<WorklistKind, string> = {
  'nilai-kritis': 'Nilai kritis',
  cosign: 'Co-sign CPPT residen',
  'menunggu-cosign': 'Menunggu co-sign DPJP',
  verifikasi: 'Verifikasi CPPT PPA',
  'review-order': 'Tinjau order residen',
  'hasil-baru': 'Hasil baru',
  konsul: 'Konsultasi masuk',
  resume: 'Resume pulang',
  obat: 'Pemberian obat',
  reasesmen: 'Reasesmen',
  askep: 'Evaluasi askep',
  edukasi: 'Edukasi',
  'serah-terima': 'Serah terima shift',
  observasi: 'Observasi',
};

export type WorklistPriority = 'kritis' | 'tinggi' | 'normal';

export const PRIORITY_LABEL: Record<WorklistPriority, string> = {
  kritis: 'Kritis',
  tinggi: 'Prioritas tinggi',
  normal: 'Rutin',
};

export type WorklistAction =
  /** Nilai kritis: penerima membaca ulang nilainya (komunikasi efektif, SKP 2) sebelum tercatat diterima. */
  | { kind: 'baca-ulang'; value: string; unit: string }
  | { kind: 'tandai-dibaca' }
  | { kind: 'cosign' }
  | { kind: 'verifikasi' }
  | { kind: 'setujui-order' }
  /** Diselesaikan di layar lain (tautan `target`). */
  | { kind: 'buka' };

export interface WorklistTarget {
  /** Id layar `SCREENS`. */
  screen: string;
  /** Akhiran rute berparameter (mis. `/<encounterId>`), tanpa = `?pasien=`. */
  suffix?: string;
  /** Kueri tambahan, mis. `tab=emar`. */
  query?: string;
}

export interface WorklistTask {
  id: string;
  kind: WorklistKind;
  priority: WorklistPriority;
  encounterId: string;
  patientId: string;
  title: string;
  detail: string;
  /** Instan ISO saat tugas muncul. */
  createdAt: string;
  /** Batas waktu (instan ISO), null = tanpa batas. */
  dueAt: string | null;
  action: WorklistAction;
  target: WorklistTarget | null;
  /** Posisi ini tidak menyelesaikan tugas ini sendiri (mis. residen menunggu co-sign DPJP): alasannya. */
  waitingFor?: string;
}

export type WorklistPatientStatus =
  | 'menunggu'
  | 'diperiksa'
  | 'menunggu-hasil'
  | 'dirawat'
  | 'pulang-hari-ini'
  | 'konsul'
  | 'pra-operasi'
  | 'nifas';

export const PATIENT_STATUS_META: Record<
  WorklistPatientStatus,
  { label: string; tone: 'brand' | 'neutral' | 'warning' | 'success' | 'danger' | 'info' }
> = {
  menunggu: { label: 'Menunggu', tone: 'neutral' },
  diperiksa: { label: 'Diperiksa', tone: 'brand' },
  'menunggu-hasil': { label: 'Menunggu hasil', tone: 'warning' },
  dirawat: { label: 'Dirawat', tone: 'info' },
  'pulang-hari-ini': { label: 'Pulang hari ini', tone: 'success' },
  konsul: { label: 'Konsul', tone: 'warning' },
  'pra-operasi': { label: 'Pra-operasi', tone: 'danger' },
  nifas: { label: 'Nifas', tone: 'info' },
};

export interface WorklistPatient {
  encounterId: string;
  patientId: string;
  status: WorklistPatientStatus;
  /** Konteks singkat: hari rawat, lokasi, rencana. */
  note: string;
}

export interface WorklistDone {
  at: string;
  by: string;
  note: string;
}

const RANK: Record<WorklistPriority, number> = { kritis: 0, tinggi: 1, normal: 2 };

export function isOverdue(task: Pick<WorklistTask, 'dueAt'>, nowIso: string): boolean {
  return task.dueAt !== null && Date.parse(task.dueAt) < Date.parse(nowIso);
}

/**
 * Urutan kerja: kritis dulu, lalu yang sudah lewat batas, lalu batas terdekat, lalu yang paling lama menunggu.
 * Tugas "menunggu pihak lain" (residen menunggu co-sign) di akhir: bukan pekerjaan posisi ini.
 */
export function sortTasks<T extends WorklistTask>(tasks: readonly T[], nowIso: string): T[] {
  const key = (t: T): [number, number, number, number, number] => [
    t.waitingFor ? 1 : 0,
    RANK[t.priority],
    isOverdue(t, nowIso) ? 0 : 1,
    t.dueAt ? Date.parse(t.dueAt) : Number.MAX_SAFE_INTEGER,
    Date.parse(t.createdAt),
  ];
  return [...tasks].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const d = (ka[i] ?? 0) - (kb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** "45 mnt", "1 jam", "2 jam 15 mnt". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} mnt`;
  return r === 0 ? `${h} jam` : `${h} jam ${r} mnt`;
}

/** Label tenggat bertulisan (bukan hanya warna): "Lewat 45 mnt", "1 jam 15 mnt lagi", "Tanpa batas waktu". */
export function dueLabel(task: Pick<WorklistTask, 'dueAt'>, nowIso: string): string {
  if (!task.dueAt) return 'Tanpa batas waktu';
  const diff = (Date.parse(task.dueAt) - Date.parse(nowIso)) / 60_000;
  return diff < 0 ? `Lewat ${formatDuration(-diff)}` : `${formatDuration(diff)} lagi`;
}

/** Nilai yang dibaca ulang cocok dengan nilai kritis: koma/titik desimal setara, spasi diabaikan. */
export function readBackMatches(input: string, expected: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, '').replace(',', '.');
  const a = norm(input);
  return a !== '' && a === norm(expected);
}

/** Posisi ini boleh menyelesaikan tugas langsung di worklist? Null = boleh; selain itu alasan (tampil di layar). */
export function completionBlocker(task: WorklistTask, role: WorklistRole | null): string | null {
  if (task.waitingFor) return task.waitingFor;
  switch (task.action.kind) {
    case 'cosign':
    case 'verifikasi':
    case 'setujui-order':
      return role === 'dokter' ? null : 'Hanya DPJP (posisi dokter) yang dapat menyelesaikan tugas ini.';
    case 'baca-ulang':
    case 'tandai-dibaca':
      return role ? null : 'Pilih posisi klinis untuk menerima tugas ini.';
    case 'buka':
      return 'Diselesaikan di layar tindak lanjut.';
  }
}

/** Catatan penyelesaian (tampil "Diterima dan dibaca ulang · 10.52 · nama"). */
export function completionNote(task: WorklistTask, followUp?: string): string {
  switch (task.action.kind) {
    case 'baca-ulang':
      return `Diterima dan dibaca ulang: ${task.action.value} ${task.action.unit}${followUp ? ` · tindak lanjut: ${followUp}` : ''}`;
    case 'tandai-dibaca':
      return 'Hasil dibaca';
    case 'cosign':
      return 'Co-sign DPJP · CPPT residen final';
    case 'verifikasi':
      return 'Diverifikasi DPJP';
    case 'setujui-order':
      return 'Order residen disetujui DPJP';
    case 'buka':
      return 'Selesai';
  }
}

export interface WorklistSummary {
  open: number;
  critical: number;
  overdue: number;
  done: number;
}

export function worklistSummary(
  tasks: readonly WorklistTask[],
  done: Readonly<Record<string, WorklistDone>>,
  nowIso: string,
): WorklistSummary {
  const open = tasks.filter((t) => !done[t.id]);
  return {
    open: open.length,
    critical: open.filter((t) => t.priority === 'kritis').length,
    overdue: open.filter((t) => isOverdue(t, nowIso)).length,
    done: tasks.length - open.length,
  };
}

/** Tautan tindak lanjut: rute layar + akhiran berparameter, atau `?pasien=`. */
export function targetHref(route: string, task: Pick<WorklistTask, 'encounterId' | 'target'>): string {
  const t = task.target;
  const query = t?.query ? `${t.suffix ? '?' : '&'}${t.query}` : '';
  return t?.suffix ? `${route}${t.suffix}${query}` : `${route}?pasien=${task.encounterId}${query}`;
}
