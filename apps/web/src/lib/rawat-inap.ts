import {
  type Bed,
  type BedStatus,
  type ConsentDocument,
  type CpptEntry,
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
  OCCUPIED_BED_STATUSES,
  SAFETY_REASON_MIN,
  RESUME_CHECK_IDS,
  type ResumeCheckId,
  type ResumeSection,
  type TriageLevel,
  type Ward,
  type WardClass,
} from '@simrs/shared';

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
}

export const TRIAGE_META: Record<TriageLevel, TriageMeta> = {
  1: {
    label: 'Resusitasi',
    target: 'segera',
    badge: 'border-[#9A1E14] bg-triage-1 text-white',
    rail: 'shadow-[inset_4px_0_0_#B42318]',
    selected: 'border-2 border-[#9A1E14] bg-triage-1 text-white ring-3 ring-[rgba(180,35,24,0.18)]',
  },
  2: {
    label: 'Emergensi',
    target: '≤ 10 menit',
    badge: 'border-[#A42A08] bg-triage-2 text-white',
    rail: 'shadow-[inset_4px_0_0_#C4320A]',
    selected: 'border-2 border-[#A42A08] bg-triage-2 text-white ring-3 ring-[rgba(196,50,10,0.18)]',
  },
  3: {
    label: 'Urgen',
    target: '≤ 30 menit',
    badge: 'border-[#F5D9A8] bg-triage-3 text-[#7A4300]',
    rail: 'shadow-[inset_4px_0_0_#E9B949]',
    selected: 'border-2 border-[#F5D9A8] bg-triage-3 text-[#7A4300] ring-3 ring-[rgba(181,71,8,0.18)]',
  },
  4: {
    label: 'Semi-urgen',
    target: '≤ 60 menit',
    badge: 'border-[#BFE3C6] bg-triage-4 text-[#1E6B34]',
    rail: 'shadow-[inset_4px_0_0_#7CC08B]',
    selected: 'border-2 border-[#BFE3C6] bg-triage-4 text-[#1E6B34] ring-3 ring-[rgba(30,107,52,0.18)]',
  },
  5: {
    label: 'Tidak urgen',
    target: '≤ 120 menit',
    badge: 'border-[#C7D7FE] bg-triage-5 text-[#1E3A8A]',
    rail: 'shadow-[inset_4px_0_0_#8DA8F0]',
    selected: 'border-2 border-[#C7D7FE] bg-triage-5 text-[#1E3A8A] ring-3 ring-[rgba(30,58,138,0.18)]',
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

/** Memilih level lebih rendah (angka lebih besar) dari saran sistem = override yang wajib beralasan. */
export function triageNeedsReason(suggested: TriageLevel, chosen: TriageLevel): boolean {
  return chosen > suggested;
}

/** Simpan triase boleh bila tidak turun dari saran, atau turun dengan alasan ≥ 10 karakter. */
export function triageSaveAllowed(suggested: TriageLevel, chosen: TriageLevel, reason: string): boolean {
  return !triageNeedsReason(suggested, chosen) || reason.trim().length >= SAFETY_REASON_MIN;
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
  if (chosen > item.maxLevel) {
    return `Level ${chosen} tidak diizinkan protokol pasien ini (paling rendah level ${item.maxLevel}).`;
  }
  if (!triageSaveAllowed(item.suggestedLevel, chosen, reason)) {
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
  registrasi: { label: 'Identifikasi', tone: 'bg-info-bg text-info' },
  triase: { label: 'Triase', tone: 'bg-warning-bg text-warning' },
  resusitasi: { label: 'Resusitasi aktif', tone: 'bg-danger-bg text-danger' },
  pemeriksaan: { label: 'Pemeriksaan', tone: 'bg-brand-50 text-brand-700' },
  'tunggu-dokter': { label: 'Tunggu dokter', tone: 'bg-info-bg text-info' },
  'tunggu-lab': { label: 'Tunggu lab', tone: 'bg-warning-bg text-warning' },
  observasi: { label: 'Observasi', tone: 'bg-muted text-ink-700' },
  'tunggu-bed': { label: 'Tunggu bed ranap', tone: 'bg-warning-bg text-warning' },
  'siap-pulang': { label: 'Siap pulang', tone: 'bg-success-bg text-success' },
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

/** Lama tinggal melewati batas: boarding ≥ 4 jam, atau level 1–2 menunggu dokter > 10 menit. */
export function losOverdue(item: Pick<EdTrackingItem, 'triageLevel' | 'status'>, minutes: number): boolean {
  if (minutes >= 240) return true;
  return (
    item.triageLevel !== null && item.triageLevel <= 2 && item.status === 'tunggu-dokter' && minutes > 10
  );
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
    boarding: items.filter((p) => p.status === 'tunggu-bed' && p.losMinutes >= 240).length,
  };
}

export type WalkInKind = 'tanpa-identitas' | 'baru';

/** Id kunjungan sementara pasien datang sendiri: jenisnya ikut di id agar server memakai bawaan yang sama. */
export function walkInEncounterId(kind: WalkInKind, seq: number): string {
  return `kj-igd-${kind === 'tanpa-identitas' ? 'anon' : 'baru'}-${seq}`;
}

/**
 * Pasien IGD baru di area triase (tombol "Pasien tanpa identitas" / "+ Triase pasien baru"); identitas dan
 * tanda vital menyusul. Hanya di layar (simulasi). Pasien tanpa identitas yang ditemukan tidak sadar disarankan
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
  siap: { label: 'Siap', tile: 'border-success-border bg-[#F3FAF4]', text: 'text-success' },
  terisi: { label: 'Terisi', tile: 'border-line bg-white', text: 'text-ink-700' },
  pulang: { label: 'Pulang hari ini', tile: 'border-brand-200 bg-selected', text: 'text-brand-700' },
  dipesan: { label: 'Dipesan', tile: 'border-info-border bg-info-bg', text: 'text-info' },
  kotor: { label: 'Kotor', tile: 'border-[#D9CDBE] bg-[#F7F3EE]', text: 'text-[#6B4E2E]' },
  dibersihkan: { label: 'Dibersihkan', tile: 'border-warning-border bg-[#FFF8EB]', text: 'text-warning' },
  rusak: { label: 'Rusak', tile: 'border-danger-border bg-[#FEF3F2]', text: 'text-danger' },
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

/** Ringkasan per ruang: "60 bed · 50 terisi · 3 siap". */
export function wardSummary(ward: Ward, beds: readonly Bed[]): { counts: BedCounts; text: string } {
  const counts = bedCounts(beds.filter((b) => b.wardCode === ward.code));
  return {
    counts,
    text: `${counts.total} bed · ${counts.occupied} terisi (${percent(counts.occupied, counts.total)}%) · ${counts.siap} siap`,
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
  dpjp: { tag: 'DR', label: 'DPJP', tone: 'bg-brand-50 text-brand-700' },
  residen: { tag: 'RS', label: 'Residen', tone: 'bg-info-bg text-info' },
  perawat: { tag: 'NS', label: 'Perawat', tone: 'bg-muted text-ink-700' },
  bidan: { tag: 'BD', label: 'Bidan', tone: 'bg-[#FCEFF6] text-[#8E2A5E]' },
  farmasi: { tag: 'FA', label: 'Farmasi klinis', tone: 'bg-warning-bg text-warning' },
  gizi: { tag: 'GZ', label: 'Dietisien', tone: 'bg-success-bg text-success' },
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

/** Skor per parameter EWS dewasa (pola NEWS2): napas, SpO2, oksigen, TD sistolik, nadi, kesadaran, suhu. */
export function ewsParamScores(o: EwsInput): number[] {
  const band = (v: number, rules: Array<[number, number]>) => rules.find(([max]) => v <= max)?.[1] ?? 0;
  return [
    band(o.rr, [
      [8, 3],
      [11, 1],
      [20, 0],
      [24, 2],
      [Infinity, 3],
    ]),
    band(o.spo2, [
      [91, 3],
      [93, 2],
      [95, 1],
      [Infinity, 0],
    ]),
    o.onOxygen ? 2 : 0,
    band(o.sbp, [
      [90, 3],
      [100, 2],
      [110, 1],
      [219, 0],
      [Infinity, 3],
    ]),
    band(o.hr, [
      [40, 3],
      [50, 1],
      [90, 0],
      [110, 1],
      [130, 2],
      [Infinity, 3],
    ]),
    o.consciousness === 'A' ? 0 : 3,
    band(o.temp, [
      [35, 3],
      [36, 1],
      [38, 0],
      [39, 1],
      [Infinity, 2],
    ]),
  ];
}

/** Skor EWS dewasa = jumlah skor parameter. */
export function ewsScore(o: EwsInput): number {
  return ewsParamScores(o).reduce((a, b) => a + b, 0);
}

/** Skor parameter tunggal tertinggi (NEWS2: satu parameter bernilai 3 memicu respons urgen). */
export function ewsMaxParam(o: EwsInput): number {
  return Math.max(...ewsParamScores(o));
}

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
  if (score >= 7)
    return {
      level: 'tinggi',
      action: 'Pantau kontinu, aktifkan tim reaksi cepat.',
      tone: 'bg-danger-bg text-danger',
    };
  if (score >= 5)
    return {
      level: 'sedang',
      action: 'Observasi tiap 1 jam, lapor DPJP.',
      tone: 'bg-warning-bg text-warning',
    };
  if (maxParam >= 3)
    return {
      level: 'sedang',
      action: 'Satu parameter bernilai 3: observasi tiap 1 jam, lapor DPJP.',
      tone: 'bg-warning-bg text-warning',
    };
  return { level: 'rendah', action: 'Lanjutkan observasi tiap 4 jam.', tone: 'bg-success-bg text-success' };
}

export const EMAR_STATE_META: Record<EmarSlotState, { label: string; cls: string }> = {
  diberikan: { label: 'Diberikan', cls: 'border-success-border bg-success-bg text-success' },
  jadwal: {
    label: 'Jadwal',
    cls: 'border-brand-600 bg-[linear-gradient(180deg,#E6F4F1,#FFFFFF)] text-brand-700',
  },
  terlambat: { label: 'Terlambat', cls: 'border-danger-border bg-[#FEF3F2] text-danger' },
  ditunda: { label: 'Ditunda', cls: 'border-warning-border bg-warning-bg text-warning' },
  rencana: { label: 'Rencana', cls: 'border-line-soft bg-subtle text-ink-500' },
  kosong: { label: 'Tidak dijadwalkan', cls: 'border-line-strong bg-white text-transparent' },
};

/** "5 Okt · 07.40" (WIB) untuk daftar padat. */
export function formatTglJam(iso: string): string {
  const tgl = formatTanggal(iso)
    .replace(/^\w+, /, '')
    .replace(/ \d{4}$/, '');
  return `${tgl} · ${formatJam(iso)}`;
}

/** Slot yang bisa dicatat pemberiannya (setelah gelang cocok). */
export function emarActionable(state: EmarSlotState): boolean {
  return state === 'jadwal' || state === 'terlambat';
}

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

export const RESUME_CHECK_LABEL: Record<ResumeCheckId, string> = {
  ident: 'Identitas pasien dan data kunjungan',
  anamnesis: 'Alasan masuk dan anamnesis',
  fisik: 'Pemeriksaan fisik masuk dan pulang',
  penunjang: 'Hasil penunjang penting',
  diagnosis: 'Diagnosis utama dan sekunder berkode',
  prosedur: 'Prosedur berkode ICD-9-CM',
  terapi: 'Ringkasan terapi dari eMAR',
  rekonsiliasi: 'Rekonsiliasi obat pulang dikonfirmasi DPJP',
  edukasi: 'Edukasi pasien terdokumentasi',
  instruksi: 'Instruksi pulang dan tanda bahaya',
  kontrol: 'Jadwal kontrol dan surat kontrol',
  kondisi: 'Kondisi dan cara pulang',
};

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

export interface ResumeCompleteness {
  done: number;
  total: number;
  missing: string[];
  complete: boolean;
}

/** Kelengkapan resume: 12 butir wajib, urutan tetap; TTE hanya bila semua terpenuhi. */
export function resumeCompleteness(
  checklist: ReadonlyArray<{ id: ResumeCheckId; done: boolean }>,
): ResumeCompleteness {
  const byId = new Map(checklist.map((c) => [c.id, c.done]));
  const missing = RESUME_CHECK_IDS.filter((id) => !byId.get(id)).map((id) =>
    RESUME_CHECK_LABEL[id].toLowerCase(),
  );
  return {
    done: RESUME_CHECK_IDS.length - missing.length,
    total: RESUME_CHECK_IDS.length,
    missing,
    complete: missing.length === 0,
  };
}

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
