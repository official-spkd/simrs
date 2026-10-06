import {
  ATS_LABEL,
  ATS_TARGET_MINUTES,
  type Bed,
  type ClinicalResult,
  type BedStatus,
  type ConsentDocument,
  type CpptEntry,
  type CpptNoteInput,
  type CpptRole,
  type DischargeSummary,
  type EmarAdministrationInput,
  type EmarMedication,
  type EmarSlotState,
  type EmarTime,
  type EmarWristbandScanInput,
  type EwsObservation,
  type EdStatus,
  formatJam,
  formatTanggal,
  type EdTrackingItem,
  type EdZone,
  emarActionable,
  ewsMaxParam,
  ewsParamScores,
  ewsRisk,
  ewsScore,
  OCCUPIED_BED_STATUSES,
  RESUME_CHECK_LABEL,
  resumeCompleteness,
  type ResumeCompleteness,
  SAFETY_REASON_MIN,
  TENANT_SETTINGS,
  triageBlockReason,
  type ResumeSection,
  triageNeedsReason,
  type TriageLevel,
  type Ward,
  type WardClass,
} from '@simrs/shared';
import type { ValueFlag } from './klinis';

/**
 * K03–K13 · Fungsi murni tampilan IGD, tempat tidur, rawat inap, resume, dan persetujuan tindakan (mode
 * presentasi, ADR-0023). Tanpa I/O: dipakai halaman server, komponen klien, dan tes unit.
 */

// ---------------------------------------------------------------------------------------------------------
// Triase dan papan IGD
// ---------------------------------------------------------------------------------------------------------

export interface TriageMeta {
  label: string;
  /** Target waktu ditemui dokter. */
  target: string;
  /** Kelas lencana (latar + teks + garis); status juga selalu tertulis, tidak hanya warna. */
  badge: string;
  /** Garis kiri baris papan. */
  rail: string;
  /** Kelas radio terpilih. */
  selected: string;
  /** Kotak "Saran sistem" untuk level terpilih (mockup IGD: 1–2 merah, 3 kuning, 4 hijau, 5 biru). */
  advice: { box: string; label: string };
  /** Tombol simpan triase aktif (gradasi warna level); nonaktif memakai `TRIAGE_SAVE_DISABLED`. */
  save: string;
}

/** Tombol simpan triase nonaktif: abu (mockup IGD), bukan warna level. */
export const TRIAGE_SAVE_DISABLED = 'cursor-not-allowed border-line bg-batu-100 text-ink-400';

const ADVICE_RED = {
  box: 'border-koral-200 bg-[linear-gradient(120deg,var(--color-koral-50),var(--color-koral-100))]',
  label: 'text-koral-800',
};

/** Nama level dan target waktu dokter dari skala ATS bersama (`@simrs/shared`, keputusan fase 3 no. 6). */
function atsText(level: TriageLevel): Pick<TriageMeta, 'label' | 'target'> {
  const minutes = ATS_TARGET_MINUTES[level];
  return { label: ATS_LABEL[level], target: minutes === 0 ? 'segera' : `≤ ${minutes} menit` };
}

export const TRIAGE_META: Record<TriageLevel, TriageMeta> = {
  1: {
    ...atsText(1),
    badge: 'border-koral-700 bg-triage-1 text-white',
    rail: 'shadow-[inset_4px_0_0_var(--color-koral-600)]',
    selected:
      'border-2 border-koral-700 bg-triage-1 text-white ring-3 ring-[color-mix(in_srgb,var(--color-koral-600)_18%,transparent)]',
    advice: ADVICE_RED,
    save: 'cursor-pointer border-koral-800 bg-[linear-gradient(135deg,var(--color-koral-800),var(--color-koral-600))] text-white shadow-button',
  },
  2: {
    ...atsText(2),
    badge: 'border-[color-mix(in_srgb,var(--color-triage-2)_80%,black)] bg-triage-2 text-white',
    rail: 'shadow-[inset_4px_0_0_var(--color-triage-2)]',
    selected:
      'border-2 border-[color-mix(in_srgb,var(--color-triage-2)_80%,black)] bg-triage-2 text-white ring-3 ring-[color-mix(in_srgb,var(--color-triage-2)_18%,transparent)]',
    advice: ADVICE_RED,
    save: 'cursor-pointer border-[color-mix(in_srgb,var(--color-triage-2)_80%,black)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-triage-2)_75%,black),var(--color-triage-2))] text-white shadow-button',
  },
  3: {
    ...atsText(3),
    badge: 'border-kunyit-200 bg-triage-3 text-kunyit-800',
    rail: 'shadow-[inset_4px_0_0_var(--color-kunyit-400)]',
    selected:
      'border-2 border-kunyit-200 bg-triage-3 text-kunyit-800 ring-3 ring-[color-mix(in_srgb,var(--color-kunyit-600)_18%,transparent)]',
    advice: {
      box: 'border-kunyit-200 bg-[linear-gradient(120deg,var(--color-kunyit-50),var(--color-kunyit-100))]',
      label: 'text-kunyit-800',
    },
    save: 'cursor-pointer border-kunyit-800 bg-[linear-gradient(135deg,var(--color-kunyit-800),var(--color-kunyit-600))] text-white shadow-button',
  },
  4: {
    ...atsText(4),
    badge: 'border-zamrud-200 bg-triage-4 text-zamrud-800',
    rail: 'shadow-[inset_4px_0_0_var(--color-zamrud-400)]',
    selected:
      'border-2 border-zamrud-200 bg-triage-4 text-zamrud-800 ring-3 ring-[color-mix(in_srgb,var(--color-zamrud-600)_18%,transparent)]',
    advice: {
      box: 'border-zamrud-200 bg-[linear-gradient(120deg,var(--color-zamrud-50),var(--color-zamrud-100))]',
      label: 'text-zamrud-800',
    },
    save: 'cursor-pointer border-zamrud-800 bg-[linear-gradient(135deg,var(--color-zamrud-800),var(--color-zamrud-600))] text-white shadow-button',
  },
  5: {
    ...atsText(5),
    badge: 'border-samudra-200 bg-triage-5 text-samudra-800',
    rail: 'shadow-[inset_4px_0_0_var(--color-samudra-300)]',
    selected:
      'border-2 border-samudra-200 bg-triage-5 text-samudra-800 ring-3 ring-[color-mix(in_srgb,var(--color-samudra-600)_18%,transparent)]',
    advice: {
      box: 'border-samudra-200 bg-[linear-gradient(120deg,var(--color-samudra-50),var(--color-samudra-100))]',
      label: 'text-samudra-800',
    },
    save: 'cursor-pointer border-samudra-800 bg-[linear-gradient(135deg,var(--color-samudra-800),var(--color-samudra-600))] text-white shadow-button',
  },
};

/** Tindakan umum per level (dipakai bila tidak ada penjelasan khusus kasus). */
export const TRIAGE_GENERIC: Record<TriageLevel, string> = {
  1: 'Resusitasi: penanganan segera di bed resusitasi, aktifkan tim kode biru, dokter 0 menit.',
  2: 'Emergensi: tempatkan di bed resusitasi/akut, dokter ≤ 10 menit, monitor tanda vital kontinu.',
  3: 'Urgen: zona akut, dokter ≤ 30 menit, ulang tanda vital tiap 30 menit.',
  4: 'Semi-urgen: zona akut atau kursi, dokter ≤ 60 menit, tanda vital tiap 1 jam.',
  5: 'Tidak urgen: fast track, dokter ≤ 120 menit; pertimbangkan rujuk balik ke FKTP.',
};

export function isTriageLevel(n: number): n is TriageLevel {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Memilih level lebih rendah (angka lebih besar) dari saran sistem = override yang wajib beralasan (`@simrs/shared`). */
export { triageNeedsReason };

/** Simpan triase boleh bila tidak turun dari saran, atau turun dengan alasan ≥ 10 karakter (`triageBlockReason`). */
export function triageSaveAllowed(suggested: TriageLevel, chosen: TriageLevel, reason: string): boolean {
  return triageBlockReason({ level: suggested, maxLevel: 5 }, chosen, reason, SAFETY_REASON_MIN) === null;
}

/** Posisi yang boleh menetapkan triase. Petugas pendaftaran tetap mengerjakan admisi dan identifikasi. */
export const TRIAGE_ROLES: readonly string[] = ['perawat', 'dokter', 'dokter_residen'];
export const TRIAGE_ROLE_REASON = 'Triase oleh perawat/dokter';

export function canTriage(roleCode: string | null | undefined): boolean {
  return !!roleCode && TRIAGE_ROLES.includes(roleCode);
}

/**
 * Gerbang triase sisi server: level di atas batas protokol ditolak (mis. nyeri dada minimal urgen), level di bawah
 * saran sistem wajib alasan ≥ 10 karakter. Saran dan batas berasal dari data IGD server, bukan dari klien.
 */
export function triageBlocker(
  item: Pick<EdTrackingItem, 'suggestedLevel' | 'maxLevel'>,
  chosen: TriageLevel,
  reason: string,
): string | null {
  const code = triageBlockReason(
    { level: item.suggestedLevel, maxLevel: item.maxLevel },
    chosen,
    reason,
    SAFETY_REASON_MIN,
  );
  if (code === 'TRIAGE_LEVEL_NOT_ALLOWED') {
    return `Level ${chosen} tidak diizinkan protokol pasien ini (paling rendah level ${item.maxLevel}).`;
  }
  if (code === 'TRIAGE_REASON_REQUIRED') {
    return `Level di bawah saran sistem wajib disertai alasan klinis (minimal ${SAFETY_REASON_MIN} karakter).`;
  }
  return null;
}

export const ED_ZONE_LABEL: Record<EdZone, string> = {
  T: 'Area triase',
  R: 'Resusitasi',
  B: 'Akut',
  K: 'Fast track',
};

export const ED_STATUS_META: Record<EdStatus, { label: string; tone: string }> = {
  registrasi: { label: 'Identifikasi', tone: 'bg-samudra-100 text-samudra-800' },
  triase: { label: 'Triase', tone: 'bg-kunyit-100 text-kunyit-800' },
  resusitasi: { label: 'Resusitasi aktif', tone: 'bg-koral-100 text-koral-800' },
  pemeriksaan: { label: 'Pemeriksaan', tone: 'bg-brand-100 text-brand-800' },
  'tunggu-dokter': { label: 'Tunggu dokter', tone: 'bg-samudra-100 text-samudra-800' },
  'tunggu-lab': { label: 'Tunggu lab', tone: 'bg-kunyit-100 text-kunyit-800' },
  observasi: { label: 'Observasi', tone: 'bg-batu-200 text-batu-800' },
  'tunggu-bed': { label: 'Tunggu bed ranap', tone: 'bg-kunyit-100 text-kunyit-800' },
  'siap-pulang': { label: 'Siap pulang', tone: 'bg-zamrud-100 text-zamrud-800' },
};

const two = (n: number) => String(n).padStart(2, '0');

/** Lama di IGD gaya papan: `01.35 j`. */
export function formatLos(minutes: number): string {
  return `${two(Math.floor(minutes / 60))}.${two(minutes % 60)} j`;
}

/** Penghitung waktu `hh:mm:ss`. */
export function formatTimer(seconds: number): string {
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
}

/**
 * Target boarding: pasien di IGD (atau permintaan bed dari IGD) menunggu ≥ `bed.boarding_alert_hours` (bawaan 4 jam)
 * = lewat batas. Mode presentasi memakai nilai bawaan pengaturan.
 */
const BOARDING_HOURS = TENANT_SETTINGS['bed.boarding_alert_hours'].default;
export const BOARDING_TARGET_MINUTES = BOARDING_HOURS * 60;
/** Teks penanda boarding lewat batas (papan IGD, panel triase, permintaan bed). */
export const BOARDING_LATE_LABEL = `Lewat ${BOARDING_HOURS} jam`;
/** Target ditemui dokter untuk triase 1–2 (menit). */
const HIGH_TRIAGE_DOCTOR_MINUTES = ATS_TARGET_MINUTES[2];

/**
 * Teks penanda lama tinggal yang melewati batas (status tidak hanya lewat warna): ≥ 4 jam di IGD, atau triase 1–2
 * menunggu dokter > 10 menit. Null = masih dalam batas.
 */
export function edLosAlert(
  item: Pick<EdTrackingItem, 'triageLevel' | 'status'>,
  minutes: number,
): string | null {
  if (minutes >= BOARDING_TARGET_MINUTES) return BOARDING_LATE_LABEL;
  if (
    item.triageLevel !== null &&
    item.triageLevel <= 2 &&
    item.status === 'tunggu-dokter' &&
    minutes > HIGH_TRIAGE_DOCTOR_MINUTES
  ) {
    return `Dokter lewat ${HIGH_TRIAGE_DOCTOR_MINUTES} menit`;
  }
  return null;
}

/** Lama tinggal melewati batas (lihat `edLosAlert`). */
export function losOverdue(item: Pick<EdTrackingItem, 'triageLevel' | 'status'>, minutes: number): boolean {
  return edLosAlert(item, minutes) !== null;
}

/** Titik tengah rentang normal dewasa per tanda vital IGD (TD = sistolik). */
const ED_VITAL_MIDPOINT: Readonly<Record<string, number>> = { TD: 120, Nadi: 80, Napas: 16, Suhu: 37 };
/** Tanda vital yang hanya bisa abnormal ke bawah (SpO2 maks. 100%, GCS maks. 15). */
const ED_VITAL_LOW_ONLY: readonly string[] = ['SpO2', 'GCS'];

/**
 * Arah tanda vital IGD yang ditandai abnormal oleh sumber data (kontrak hanya memuat `abnormal`), agar layar
 * menulis "Tinggi"/"Rendah": di atas titik tengah rentang normal = tinggi, di bawahnya = rendah. Tanda vital tak
 * dikenal atau nilai tak terbaca → 'abnormal' (tanpa arah). Null = tidak abnormal.
 */
export function edVitalFlag(
  v: Pick<EdTrackingItem['vitals'][number], 'label' | 'value' | 'abnormal'>,
): ValueFlag | null {
  if (!v.abnormal) return null;
  if (ED_VITAL_LOW_ONLY.includes(v.label)) return 'rendah';
  const mid = ED_VITAL_MIDPOINT[v.label];
  // "186/104" → 186 (sistolik), "38,9" → 38.9.
  const n = Number.parseFloat(v.value.replace(',', '.'));
  if (mid === undefined || Number.isNaN(n)) return 'abnormal';
  return n > mid ? 'tinggi' : 'rendah';
}

export function filterEdItems<T extends Pick<EdTrackingItem, 'zone' | 'triageLevel'>>(
  items: readonly T[],
  zone: EdZone | 'semua',
  level: TriageLevel | 0,
): T[] {
  return items.filter((p) => (zone === 'semua' || p.zone === zone) && (!level || p.triageLevel === level));
}

export interface EdKpis {
  total: number;
  high: number;
  untriaged: number;
  boarding: number;
}

export function edKpis(items: readonly EdTrackingItem[]): EdKpis {
  return {
    total: items.length,
    high: items.filter((p) => p.triageLevel !== null && p.triageLevel <= 2).length,
    untriaged: items.filter((p) => p.triageLevel === null).length,
    boarding: items.filter((p) => p.status === 'tunggu-bed' && p.losMinutes >= BOARDING_TARGET_MINUTES)
      .length,
  };
}

export type WalkInKind = 'tanpa-identitas' | 'baru';

/** Id kunjungan sementara pasien datang sendiri: jenisnya ikut di id agar server memakai bawaan yang sama. */
export function walkInEncounterId(kind: WalkInKind, seq: number): string {
  return `kj-igd-${kind === 'tanpa-identitas' ? 'anon' : 'baru'}-${seq}`;
}

/**
 * Pasien IGD baru di area triase (tombol "Pasien tanpa identitas" / "+ Triase pasien baru"); identitas dan
 * tanda vital menyusul; tersimpan di toko demo `klinis-igd`. Pasien tanpa identitas yang ditemukan tidak sadar disarankan
 * triase 1 sampai jalan napas dan tanda vital aman.
 */
export function newWalkIn(kind: WalkInKind, seq: number, arrivedAt: string): EdTrackingItem {
  const anon = kind === 'tanpa-identitas';
  return {
    encounterId: walkInEncounterId(kind, seq),
    bed: null,
    zone: 'T',
    patientId: null,
    patientName: anon ? `Tn. X-${seq} (tanpa identitas)` : `Pasien baru ${seq} · identitas menyusul`,
    rm: null,
    sex: anon ? 'L' : 'P',
    ageLabel: anon ? '±30 th' : 'umur menyusul',
    guarantor: anon ? 'Belum diketahui' : 'Penjamin menyusul',
    triageLevel: null,
    suggestedLevel: anon ? 1 : 3,
    maxLevel: 5,
    chiefComplaint: anon ? 'Ditemukan tidak sadar di jalan' : 'Keluhan dicatat saat triase',
    doctor: null,
    arrivedAt,
    losMinutes: 0,
    status: anon ? 'registrasi' : 'triase',
    arrivalMode: anon ? 'diantar warga' : 'datang sendiri',
    vitals: ['TD', 'Nadi', 'Napas', 'SpO2', 'Suhu', 'GCS'].map((label) => ({
      label,
      value: '—',
      abnormal: false,
    })),
    recommendation: anon
      ? 'Tidak sadar tanpa identitas: triase 1, amankan jalan napas, pasang monitor, cek gula darah segera.'
      : 'Saran awal level 3 sampai tanda vital tercatat; sistem menghitung ulang setelah tanda vital masuk.',
    orderTitle: 'Order awal (alur umum)',
    orders: [
      { id: 'dl', label: 'Darah lengkap', defaultOn: true },
      { id: 'gds', label: 'Gula darah sewaktu', defaultOn: anon },
      { id: 'konsul', label: 'Konsul DPJP jaga', defaultOn: false },
    ],
    scenario: false,
  };
}

/** Bawaan server untuk pasien datang sendiri dari id sementaranya (`kj-igd-anon-3`), atau null bila bukan. */
export function walkInFromId(encounterId: string, arrivedAt: string): EdTrackingItem | null {
  const m = /^kj-igd-(anon|baru)-([1-9]\d{0,3})$/.exec(encounterId);
  if (!m) return null;
  return newWalkIn(m[1] === 'anon' ? 'tanpa-identitas' : 'baru', Number(m[2]), arrivedAt);
}

// ---------------------------------------------------------------------------------------------------------
// Tempat tidur
// ---------------------------------------------------------------------------------------------------------

export const BED_STATUS_META: Record<BedStatus, { label: string; tile: string; text: string }> = {
  siap: { label: 'Siap', tile: 'border-success-border bg-zamrud-50', text: 'text-success' },
  terisi: { label: 'Terisi', tile: 'border-line bg-white', text: 'text-ink-700' },
  pulang: { label: 'Pulang hari ini', tile: 'border-brand-200 bg-selected', text: 'text-brand-700' },
  dipesan: { label: 'Dipesan', tile: 'border-info-border bg-info-bg', text: 'text-info' },
  kotor: { label: 'Kotor', tile: 'border-dashed border-batu-400 bg-batu-100', text: 'text-batu-800' },
  dibersihkan: { label: 'Dibersihkan', tile: 'border-warning-border bg-kunyit-50', text: 'text-warning' },
  rusak: { label: 'Rusak', tile: 'border-danger-border bg-koral-50', text: 'text-danger' },
};

export function isOccupied(status: BedStatus): boolean {
  return OCCUPIED_BED_STATUSES.includes(status);
}

export type BedCounts = Record<BedStatus, number> & { total: number; occupied: number };

export function bedCounts(beds: readonly Pick<Bed, 'status'>[]): BedCounts {
  const c: BedCounts = {
    siap: 0,
    terisi: 0,
    pulang: 0,
    dipesan: 0,
    kotor: 0,
    dibersihkan: 0,
    rusak: 0,
    total: beds.length,
    occupied: 0,
  };
  for (const b of beds) {
    c[b.status] += 1;
    if (isOccupied(b.status)) c.occupied += 1;
  }
  return c;
}

export function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

export interface BedFilter {
  ward: string;
  kelas: WardClass | 'semua';
  status: BedStatus | 'semua';
}

export function filterBeds(beds: readonly Bed[], wards: readonly Ward[], f: BedFilter): Bed[] {
  const kelasOf = new Map(wards.map((w) => [w.code, w.kelas]));
  return beds.filter(
    (b) =>
      (f.ward === 'semua' || b.wardCode === f.ward) &&
      (f.kelas === 'semua' || kelasOf.get(b.wardCode) === f.kelas) &&
      (f.status === 'semua' || b.status === f.status),
  );
}

/** Okupansi ruang ≥ 90% = hampir penuh (sama dengan kapasitas Dasbor direksi). */
export const WARD_NEARLY_FULL_PERCENT = 90;

/** Ringkasan per ruang: "60 bed · 50 terisi (83%) · 3 siap" + okupansi dan tanda hampir penuh. */
export function wardSummary(
  ward: Ward,
  beds: readonly Bed[],
): { counts: BedCounts; text: string; percent: number; nearlyFull: boolean } {
  const counts = bedCounts(beds.filter((b) => b.wardCode === ward.code));
  const pct = percent(counts.occupied, counts.total);
  return {
    counts,
    text: `${counts.total} bed · ${counts.occupied} terisi (${pct}%) · ${counts.siap} siap`,
    percent: pct,
    nearlyFull: pct >= WARD_NEARLY_FULL_PERCENT,
  };
}

/** Menit tunggu: "4 j 40 m", "55 m"; null = terjadwal. */
export function formatWait(minutes: number | null): string {
  if (minutes === null) return 'terjadwal';
  const h = Math.floor(minutes / 60);
  return h ? `${h} j ${minutes % 60} m` : `${minutes} m`;
}

// ---------------------------------------------------------------------------------------------------------
// Rawat inap: CPPT (immutable, koreksi = versi baru), EWS, eMAR
// ---------------------------------------------------------------------------------------------------------

export const CPPT_ROLE_META: Record<CpptRole, { tag: string; label: string; tone: string }> = {
  dpjp: { tag: 'DR', label: 'DPJP', tone: 'bg-brand-100 text-brand-800' },
  residen: { tag: 'RS', label: 'Residen', tone: 'bg-samudra-100 text-samudra-800' },
  perawat: { tag: 'NS', label: 'Perawat', tone: 'bg-batu-200 text-batu-800' },
  bidan: { tag: 'BD', label: 'Bidan', tone: 'bg-bougenvil-100 text-bougenvil-800' },
  farmasi: { tag: 'FA', label: 'Farmasi klinis', tone: 'bg-anggrek-100 text-anggrek-800' },
  gizi: { tag: 'GZ', label: 'Dietisien', tone: 'bg-toska-100 text-toska-800' },
};

export type CpptFilter = 'semua' | 'dokter' | 'perawat' | 'lainnya';

export function cpptMatches(e: Pick<CpptEntry, 'role'>, f: CpptFilter): boolean {
  if (f === 'dokter') return e.role === 'dpjp' || e.role === 'residen';
  if (f === 'perawat') return e.role === 'perawat' || e.role === 'bidan';
  if (f === 'lainnya') return e.role === 'farmasi' || e.role === 'gizi';
  return true;
}

/** Posisi PPA yang menulis CPPT (dokter, residen, perawat, bidan, apoteker). */
export const CPPT_WRITER_ROLES: readonly string[] = [
  'dokter',
  'dokter_residen',
  'perawat',
  'bidan',
  'apoteker',
];

export function canWriteCppt(roleCode: string | null | undefined): boolean {
  return !!roleCode && CPPT_WRITER_ROLES.includes(roleCode);
}

/** Peran sesi → profesi penulis CPPT. */
export function cpptRoleOf(roleCode: string | null | undefined): CpptRole {
  if (roleCode === 'dokter') return 'dpjp';
  if (roleCode === 'dokter_residen') return 'residen';
  if (roleCode === 'bidan') return 'bidan';
  if (roleCode === 'apoteker') return 'farmasi';
  return 'perawat';
}

/** Entri yang sudah digantikan versi lebih baru (tetap tampil sebagai riwayat, tidak bisa dikoreksi lagi). */
export function supersededIds(entries: readonly CpptEntry[]): Set<string> {
  return new Set(entries.map((e) => e.supersedesId).filter((x): x is string => x !== null));
}

export interface SoapText {
  s: string;
  o: string;
  a: string;
  p: string;
}

/** CPPT baru (versi 1), atau addendum atas entri final PPA lain. Catatan residen wajib co-sign DPJP. */
export function newCpptEntry(a: {
  id: string;
  encounterId: string;
  role: CpptRole;
  author: string;
  at: string;
  soap: SoapText;
  addendumOf?: string | null;
}): CpptEntry {
  return {
    id: a.id,
    encounterId: a.encounterId,
    role: a.role,
    author: a.author,
    writtenAt: a.at,
    ...a.soap,
    version: 1,
    supersedesId: null,
    correctionReason: null,
    addendumOf: a.addendumOf ?? null,
    cosignRequired: a.role === 'residen',
    cosignedBy: null,
    cosignedAt: null,
  };
}

/** Koreksi hanya oleh penulis entri; PPA lain menambah addendum (entri lama tidak pernah diubah). */
export function canCorrectCppt(e: Pick<CpptEntry, 'author'>, user: string): boolean {
  return e.author === user;
}

/** Mode formulir CPPT: catatan baru, koreksi versi baru (penulis, beralasan), atau addendum PPA lain. */
export type CpptMode =
  | { kind: 'baru' }
  | { kind: 'koreksi'; targetId: string; reason: string }
  | { kind: 'addendum'; targetId: string };

/**
 * Payload `saveCpptAction` dari formulir. Dibangun di satu tempat bertipe kontrak bersama agar layar dan skema server
 * tidak menyimpang (tes unit mem-parse hasilnya dengan `cpptNoteInputSchema`).
 */
export function cpptNotePayload(encounterId: string, soap: SoapText, mode: CpptMode): CpptNoteInput {
  return {
    encounterId,
    s: soap.s,
    o: soap.o,
    a: soap.a,
    p: soap.p,
    supersedesId: mode.kind === 'koreksi' ? mode.targetId : null,
    correctionReason: mode.kind === 'koreksi' ? mode.reason : null,
    addendumOf: mode.kind === 'addendum' ? mode.targetId : null,
  };
}

/** Kunci penulis (FNV-1a 32 bit, base36) yang ikut di id CPPT lokal: server mengenali penulisnya tanpa basis data. */
export function cpptAuthorKey(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Id CPPT yang dibuat di sesi ini (belum tersimpan): `cppt-<kunci penulis>-<urutan>`. */
export function localCpptId(userId: string, seq: number): string {
  return `cppt-${cpptAuthorKey(userId)}-${seq.toString(36)}`;
}

function isOwnLocalCpptId(id: string, userId: string): boolean {
  return id.startsWith(`cppt-${cpptAuthorKey(userId)}-`);
}

/**
 * Gerbang koreksi sisi server: entri harus ada (di rekam medis, atau entri lokal milik pengguna ini), belum
 * digantikan, dan ditulis pengguna ini. Null = boleh.
 */
export function cpptCorrectionBlocker(
  entries: readonly CpptEntry[],
  targetId: string,
  user: { id: string; name: string },
): string | null {
  const target = entries.find((e) => e.id === targetId);
  if (!target) return isOwnLocalCpptId(targetId, user.id) ? null : 'Entri CPPT tidak ditemukan.';
  if (supersededIds(entries).has(targetId)) return 'Entri ini sudah dikoreksi; koreksi versi terbaru.';
  if (!canCorrectCppt(target, user.name)) {
    return 'Koreksi hanya oleh penulis catatan; PPA lain menambahkan addendum.';
  }
  return null;
}

/** Gerbang addendum: menunjuk entri rekam medis yang masih berlaku (bukan versi lama). */
export function cpptAddendumBlocker(entries: readonly CpptEntry[], targetId: string): string | null {
  if (!entries.some((e) => e.id === targetId)) return 'Entri CPPT tidak ditemukan.';
  if (supersededIds(entries).has(targetId))
    return 'Entri ini sudah dikoreksi; tambahkan addendum pada versi terbaru.';
  return null;
}

/**
 * Koreksi CPPT = entri baru `version + 1` yang menunjuk entri lama (CLAUDE.md §4.2). Entri lama tidak diubah.
 * Galat bila entri tidak ada, sudah digantikan, atau alasan kurang dari 10 karakter.
 */
export function correctCpptEntry(
  entries: readonly CpptEntry[],
  targetId: string,
  a: { id: string; author: string; role: CpptRole; at: string; soap: SoapText; reason: string },
): CpptEntry {
  const old = entries.find((e) => e.id === targetId);
  if (!old) throw new Error('Entri CPPT tidak ditemukan.');
  if (supersededIds(entries).has(targetId))
    throw new Error('Entri ini sudah dikoreksi; koreksi versi terbaru.');
  if (a.reason.trim().length < SAFETY_REASON_MIN) throw new Error('Alasan koreksi minimal 10 karakter.');
  return {
    ...newCpptEntry({
      id: a.id,
      encounterId: old.encounterId,
      role: a.role,
      author: a.author,
      at: a.at,
      soap: a.soap,
    }),
    version: old.version + 1,
    supersedesId: old.id,
    correctionReason: a.reason.trim(),
  };
}

type EwsInput = Omit<EwsObservation, 'at' | 'score' | 'dbp'>;

/** Skor NEWS2 per parameter, total, dan parameter tertinggi: mesin aturan bersama `@simrs/shared` (§3.0a). */
export { ewsMaxParam, ewsParamScores, ewsScore };

export interface EwsLevel {
  level: 'rendah' | 'sedang' | 'tinggi';
  /** Tindak lanjut sesuai tingkat. */
  action: string;
  tone: string;
}

/**
 * Tingkat EWS: ≥ 7 tinggi, 5–6 sedang, 0–4 rendah, kecuali satu parameter bernilai 3 (aturan NEWS2) yang menaikkan
 * ke minimal sedang: observasi tiap 1 jam dan lapor DPJP.
 */
export function ewsLevel(score: number, maxParam = 0): EwsLevel {
  const risk = ewsRisk(score, maxParam);
  return { ...risk, tone: EWS_TONE[risk.level] };
}

const EWS_TONE: Record<EwsLevel['level'], string> = {
  tinggi: 'bg-koral-100 text-koral-800',
  sedang: 'bg-kunyit-100 text-kunyit-800',
  rendah: 'bg-zamrud-100 text-zamrud-800',
};

/** Tingkat EWS satu observasi: skor total + aturan parameter tunggal NEWS2 (dihitung dari parameternya). */
export function observationEwsLevel(o: EwsInput & Pick<EwsObservation, 'score'>): EwsLevel {
  return ewsLevel(o.score, ewsMaxParam(o));
}

export const EMAR_STATE_META: Record<EmarSlotState, { label: string; cls: string }> = {
  diberikan: { label: 'Diberikan', cls: 'border-success-border bg-success-bg text-success' },
  jadwal: {
    label: 'Jadwal',
    cls: 'border-brand-600 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] text-brand-800',
  },
  terlambat: { label: 'Terlambat', cls: 'border-danger-border bg-koral-50 text-danger' },
  ditunda: { label: 'Ditunda', cls: 'border-warning-border bg-warning-bg text-warning' },
  ditolak: { label: 'Ditolak pasien', cls: 'border-warning-border bg-warning-bg text-warning' },
  rencana: { label: 'Rencana', cls: 'border-line-soft bg-subtle text-ink-500' },
  kosong: { label: 'Tidak dijadwalkan', cls: 'border-line-strong bg-white text-transparent' },
};

/** "5 Okt · 07.40" (WIB) untuk daftar padat. */
export function formatTglJam(iso: string): string {
  return `${formatTglSingkat(iso)} · ${formatJam(iso)}`;
}

/** "5 Okt" (tanpa hari dan tahun; zona Asia/Jakarta). */
export function formatTglSingkat(iso: string): string {
  return formatTanggal(iso)
    .replace(/^\w+, /, '')
    .replace(/ \d{4}$/, '');
}

/** Interval observasi ulang per tingkat EWS dalam jam (selaras tindak lanjut `ewsRisk`); null = pantau kontinu. */
export const EWS_REPEAT_HOURS: Record<EwsLevel['level'], number | null> = {
  rendah: 4,
  sedang: 1,
  tinggi: null,
};

/** "ulang tiap 4 jam" / "pantau kontinu" untuk ubin EWS. */
export function ewsRepeatLabel(level: EwsLevel['level']): string {
  const h = EWS_REPEAT_HOURS[level];
  return h === null ? 'pantau kontinu' : `ulang tiap ${h} jam`;
}

/** "Observasi berikutnya 15.00" dari observasi terakhir + interval EWS (tinggi: pantau kontinu, tanpa jam). */
export function nextObservationText(lastAt: string, level: EwsLevel['level']): string {
  const h = EWS_REPEAT_HOURS[level];
  if (h === null) return 'Observasi berikutnya: pantau kontinu.';
  return `Observasi berikutnya ${formatJam(new Date(Date.parse(lastAt) + h * 3_600_000))}.`;
}

/** Shift keperawatan dari jam "HH.MM": pagi 07–14, sore 14–21, malam selebihnya. */
export function nursingShift(hhmm: string): 'pagi' | 'sore' | 'malam' {
  const h = Number(hhmm.slice(0, 2));
  return h >= 7 && h < 14 ? 'pagi' : h >= 14 && h < 21 ? 'sore' : 'malam';
}

export interface GdsTrend {
  at: string;
  value: string;
  flag: ClinicalResult['flag'];
  /** Nilai sebelumnya, terbaru dulu, mis. "06.00: 188 · kemarin: 254". */
  history: string;
}

/**
 * Gula darah terakhir + dua nilai sebelumnya dari hasil penunjang (nama "Gula darah …"); null bila tidak ada hasil
 * gula darah (ubin tidak ditampilkan, nilai tidak dikarang).
 */
export function gdsTrend(results: readonly ClinicalResult[]): GdsTrend | null {
  const gds = results
    .filter((r) => /^gula darah/i.test(r.name))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const [last, ...prev] = gds;
  if (!last) return null;
  const day = (iso: string) => formatTanggal(iso);
  const yesterday = formatTanggal(new Date(Date.parse(last.at) - 86_400_000));
  const history = prev
    .slice(0, 2)
    .map((r) => {
      const when =
        day(r.at) === day(last.at)
          ? formatJam(r.at)
          : day(r.at) === yesterday
            ? 'kemarin'
            : formatTglSingkat(r.at);
      return `${when}: ${r.value.replace(/\s*mg\/dL$/i, '')}`;
    })
    .join(' · ');
  return { at: last.at, value: last.value, flag: last.flag, history };
}

/** Slot yang bisa dicatat pemberiannya (setelah gelang cocok; `@simrs/shared`). */
export { emarActionable };

/** Posisi yang mencatat pemberian obat di eMAR (perawat, bidan, dokter). */
export const EMAR_ROLES: readonly string[] = ['perawat', 'bidan', 'dokter', 'dokter_residen'];

export function canAdministerMeds(roleCode: string | null | undefined): boolean {
  return !!roleCode && EMAR_ROLES.includes(roleCode);
}

const alnum = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase();

/** Kode gelang hasil pindai cocok dengan RM pasien kunjungan (pemisah dan huruf besar diabaikan). */
export function wristbandMatches(code: string, rm: string): boolean {
  return alnum(code).length > 0 && alnum(code) === alnum(rm);
}

/** Kunci slot eMAR `<obat>|<jam>`. */
export const emarKey = (medicationId: string, time: EmarTime) => `${medicationId}|${time}`;

/** Obat yang punya dosis wajib (jadwal/terlambat) pada jam "kini". */
function dueMeds(meds: readonly EmarMedication[], now: EmarTime): EmarMedication[] {
  return meds.filter((m) => m.slots.some((s) => s.time === now && emarActionable(s.state)));
}

/** Slot yang wajib diberikan pada jam "kini" (jadwal/terlambat) dan belum dicatat di layar. */
export function dueSlots(
  meds: readonly EmarMedication[],
  now: EmarTime,
  given: Readonly<Record<string, string>>,
): string[] {
  return dueMeds(meds, now)
    .map((m) => emarKey(m.id, now))
    .filter((k) => !given[k]);
}

/** Semua dosis jam "kini" sudah dicatat (dan memang ada dosis jam itu). */
export function allDueGiven(
  meds: readonly EmarMedication[],
  now: EmarTime,
  given: Readonly<Record<string, string>>,
): boolean {
  return dueMeds(meds, now).length > 0 && dueSlots(meds, now, given).length === 0;
}

/** Kemajuan dosis jam "kini": berapa yang sudah dicatat di layar dari total dosis wajib. */
export function dueProgress(
  meds: readonly EmarMedication[],
  now: EmarTime,
  given: Readonly<Record<string, string>>,
): { given: number; total: number } {
  const total = dueMeds(meds, now).length;
  return { given: total - dueSlots(meds, now, given).length, total };
}

/**
 * Kode pada label obat dari farmasi (simulasi: id baris obat eMAR). Pindai label menghasilkan kode ini; server
 * mencocokkannya dengan obat slot yang dicatat (benar obat).
 */
export function emarLabelCode(med: Pick<EmarMedication, 'id'>): string {
  return med.id;
}

/** Kode label terpindai cocok dengan obat jadwal (pemisah dan huruf besar diabaikan). */
export function labelMatches(code: string, med: Pick<EmarMedication, 'id'>): boolean {
  return alnum(code).length > 0 && alnum(code) === alnum(emarLabelCode(med));
}

/** Gerbang identitas sisi server: kode gelang cocok dengan RM pasien, atau override (alasannya diperiksa skema). */
export function wristbandBlocker(wristbandCode: string | null, rm: string): string | null {
  if (wristbandCode !== null && !wristbandMatches(wristbandCode, rm)) {
    return 'Gelang tidak cocok dengan pasien kunjungan ini; pindai ulang gelang yang benar.';
  }
  return null;
}

/** Pemberian obat pasien skenario sebelum gilirannya (tugas `emar` langkah rawat inap / pasca operasi). */
export const SCENARIO_EMAR_WAIT = 'Menunggu giliran pemberian obat di Simulasi.';

/**
 * Giliran eMAR pasien skenario: dosis jadwal pertama hanya dicatat saat tugas `emar` gilirannya. Setelah tugas
 * selesai slot itu sudah "diberikan" di rekam, jadi gerbang slot yang menolak. Null = boleh lanjut.
 */
export function emarTurnBlocker(task: { enabled: boolean; done: boolean } | undefined): string | null {
  return task && (task.enabled || task.done) ? null : SCENARIO_EMAR_WAIT;
}

/**
 * Gerbang pencatatan satu dosis sisi server (CLAUDE.md §4.9): obat dan slot dibaca dari eMAR pasien; slot harus
 * bisa dicatat; gelang cocok dengan RM (atau override); label obat cocok dengan obat slot; terlambat wajib alasan;
 * obat kewaspadaan tinggi wajib cek ganda oleh orang lain. Null = boleh.
 */
export function emarRecordBlocker(a: {
  meds: readonly EmarMedication[];
  rm: string;
  nurse: string;
  input: Pick<
    EmarAdministrationInput,
    'medicationId' | 'time' | 'wristbandCode' | 'labelCode' | 'lateReason' | 'doubleCheckedBy'
  >;
}): string | null {
  const med = a.meds.find((m) => m.id === a.input.medicationId);
  if (!med) return 'Obat tidak ada di eMAR pasien ini.';
  const slot = med.slots.find((s) => s.time === a.input.time);
  if (!slot || !emarActionable(slot.state)) {
    return `${med.name} jam ${a.input.time} tidak bisa dicatat (${EMAR_STATE_META[slot?.state ?? 'kosong'].label.toLowerCase()}).`;
  }
  const identity = wristbandBlocker(a.input.wristbandCode, a.rm);
  if (identity) return identity;
  if (!labelMatches(a.input.labelCode, med)) {
    return `Label obat tidak cocok dengan ${med.name}; pindai label obat yang dijadwalkan.`;
  }
  if (slot.state === 'terlambat' && !a.input.lateReason) {
    return `Dosis terlambat wajib alasan (minimal ${SAFETY_REASON_MIN} karakter).`;
  }
  if (med.highAlert) {
    const second = (a.input.doubleCheckedBy ?? '').trim();
    if (second.length < 3) return `${med.name} obat kewaspadaan tinggi: wajib cek ganda perawat kedua.`;
    if (signerNameMatches(second, a.nurse)) return 'Cek ganda harus oleh petugas lain, bukan pemberi obat.';
  }
  return null;
}

/** Identitas yang sudah diverifikasi di layar: gelang cocok (kode = RM terpindai) atau override beralasan. */
export interface EmarIdentity {
  status: 'terkunci' | 'cocok' | 'override';
  reason: string | null;
}

/** Payload `scanWristbandAction`: kode gelang terpindai, atau null + alasan override verifikasi manual. */
export function emarScanPayload(
  encounterId: string,
  wristbandCode: string | null,
  overrideReason: string | null,
): EmarWristbandScanInput {
  return {
    encounterId,
    wristbandCode,
    scanOverrideReason: wristbandCode === null ? overrideReason : null,
  };
}

/**
 * Payload `recordAdministrationAction` untuk satu dosis. Satu tempat bertipe kontrak bersama agar layar dan skema
 * server tidak menyimpang (tes unit mem-parse hasilnya dengan `emarAdministrationInputSchema`).
 */
export function emarDosePayload(a: {
  encounterId: string;
  medicationId: string;
  time: EmarTime;
  /** Kode gelang terpindai (simulasi: RM pasien). */
  rm: string;
  identity: EmarIdentity;
  dose: Pick<EmarAdministrationInput, 'labelCode' | 'lateReason' | 'doubleCheckedBy'>;
}): EmarAdministrationInput {
  const override = a.identity.status === 'override';
  return {
    encounterId: a.encounterId,
    medicationId: a.medicationId,
    time: a.time,
    wristbandCode: override ? null : a.rm,
    scanOverrideReason: override ? a.identity.reason : null,
    labelCode: a.dose.labelCode,
    lateReason: a.dose.lateReason,
    doubleCheckedBy: a.dose.doubleCheckedBy,
  };
}

/** Fakta dosis tercatat menurut rekam server (terlambat, cek ganda), bukan menurut klien. */
export function emarGivenFacts(
  med: Pick<EmarMedication, 'highAlert' | 'slots'>,
  time: EmarTime,
  doubleCheckedBy: string | null,
): { late: boolean; doubleCheckedBy: string | null } {
  return {
    late: med.slots.find((s) => s.time === time)?.state === 'terlambat',
    doubleCheckedBy: med.highAlert ? (doubleCheckedBy?.trim() ?? null) : null,
  };
}

/** Teks slot setelah dicatat: "✓ 08.14", "✓ 08.20 · telat", "✓ 08.22 · cek ganda". */
export function emarGivenLabel(at: string, f: { late: boolean; doubleCheckedBy: string | null }): string {
  return `✓ ${at}${f.late ? ' · telat' : ''}${f.doubleCheckedBy ? ' · cek ganda' : ''}`;
}

// ---------------------------------------------------------------------------------------------------------
// Resume medis: 12 butir kelengkapan; TTE hanya bila lengkap, lalu terkunci (perubahan lewat addendum)
// ---------------------------------------------------------------------------------------------------------

/** Label 12 butir kelengkapan resume (`@simrs/shared`). */
export { RESUME_CHECK_LABEL };

export const RESUME_SOURCE_LABEL: Record<ResumeSection['source'], string> = {
  'asesmen-igd': 'dari asesmen awal IGD',
  cppt: 'dari CPPT',
  observasi: 'dari observasi + CPPT',
  hasil: 'dari hasil lab dan radiologi',
  emar: 'dari eMAR',
  'laporan-operasi': 'dari laporan operasi',
  rekonsiliasi: 'rekonsiliasi obat pulang',
  dpjp: 'ditulis DPJP',
  'surat-kontrol': 'surat kontrol otomatis',
};

/** Kelengkapan resume: 12 butir wajib, urutan tetap; TTE hanya bila semua terpenuhi (`@simrs/shared`). */
export { type ResumeCompleteness, resumeCompleteness };

/** Alasan tombol TTE nonaktif, atau null bila boleh ditandatangani. */
export function resumeSignBlocker(c: ResumeCompleteness, canSign: boolean, signed: boolean): string | null {
  if (signed) return 'Resume sudah final; perubahan hanya lewat addendum berversi.';
  if (!c.complete) return `TTE terkunci: lengkapi ${c.total - c.done} butir lagi (${c.missing.join(', ')}).`;
  if (!canSign) return 'Resume disiapkan; TTE hanya oleh DPJP (posisi dokter).';
  return null;
}

/**
 * Gerbang TTE resume sisi server: hanya resume yang dikenal dan sudah disiapkan, bukan milik pasien skenario (TTE
 * lewat tugas skenario), dan belum final. Null = boleh.
 */
export function resumeSignTargetBlocker(
  found:
    | { kind: 'resume'; summary: Pick<DischargeSummary, 'signedAt'>; scenario: boolean }
    | { kind: 'belum-disiapkan' }
    | null,
): string | null {
  if (found?.kind !== 'resume') return 'Resume tidak dikenal atau belum disiapkan.';
  if (found.scenario) return 'Resume pasien simulasi ditandatangani lewat langkah skenario.';
  if (found.summary.signedAt) return 'Resume sudah final; perubahan hanya lewat addendum berversi.';
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Persetujuan tindakan: TTE hanya atas dokumen draf, tujuh butir persis, nama penanda tangan cocok
// ---------------------------------------------------------------------------------------------------------

const HONORIFIC = /^(tn|ny|nn|sdr|sdri|an|bp|bpk|ibu)\.?\s+/i;

function personName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(HONORIFIC, '').toLowerCase();
}

/** Nama yang diketik/ditandatangani sama dengan nama penanda tangan (spasi, huruf besar, sapaan diabaikan). */
export function signerNameMatches(typed: string, expected: string): boolean {
  const t = personName(typed);
  return t.length > 0 && t === personName(expected);
}

/** Dua daftar id berisi himpunan yang sama persis (tanpa duplikat, tanpa tambahan). */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  return sa.size === a.length && a.length === b.length && b.every((x) => sa.has(x));
}

/** TTE persetujuan pasien skenario sebelum gilirannya (tugas `tata-laksana.consent`). */
export const SCENARIO_CONSENT_WAIT = 'Menunggu giliran persetujuan di Simulasi.';

/** Label status dokumen persetujuan (daftar tablet dan kepala dokumen; status tidak hanya lewat warna). */
export const CONSENT_STATUS_LABEL: Record<ConsentDocument['status'], string> = {
  draf: 'Menunggu tanda tangan',
  final: 'Final · TTE',
  ditolak: 'Ditolak pasien',
};

/** Gerbang penolakan sisi server: hanya atas dokumen draf (final dan ditolak sudah terkunci). Null = boleh. */
export function consentRefusalBlocker(doc: Pick<ConsentDocument, 'status'>): string | null {
  if (doc.status === 'final') return 'Dokumen sudah final; penolakan tidak bisa dicatat.';
  if (doc.status === 'ditolak') return 'Penolakan tindakan sudah tercatat; dokumen terkunci.';
  return null;
}

/** Gerbang TTE persetujuan sisi server (dokumen dibaca server). Null = boleh. */
export function consentFinalizeBlocker(
  doc: Pick<ConsentDocument, 'status' | 'items' | 'signerName' | 'witness'>,
  input: { acknowledged: readonly string[]; patient: { name: string }; witness: { name: string } },
): string | null {
  if (doc.status === 'final') return 'Dokumen sudah final; perubahan hanya lewat addendum.';
  if (doc.status !== 'draf') return 'Pasien menolak tindakan; dokumen tidak bisa ditandatangani.';
  if (
    !sameIdSet(
      input.acknowledged,
      doc.items.map((i) => i.id),
    )
  ) {
    return 'Ketujuh butir informasi wajib dipahami sebelum TTE.';
  }
  if (!signerNameMatches(input.patient.name, doc.signerName)) {
    return `Tanda tangan pasien/keluarga harus atas nama ${doc.signerName}.`;
  }
  if (!signerNameMatches(input.witness.name, doc.witness.name)) {
    return `Tanda tangan saksi harus atas nama ${doc.witness.name}.`;
  }
  return null;
}
