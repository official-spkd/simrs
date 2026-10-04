import {
  ICD10_PATTERN,
  type Payer,
  type PractitionerQuota,
  type Referral,
  type ScheduleSlot,
  type SlotQuota,
} from '@simrs/shared';
import { taskKey } from './demo/engine/run';
import type { RunResult } from './demo/engine/types';
import type { FrontOfficeProgress } from './demo/fixtures/front-office';

/**
 * Fungsi murni front office (F01 jadwal, F03/F06 pendaftaran, F04 papan antrean, F05 anjungan): aturan kuota,
 * nomor antrean, langkah pendaftaran, dan proyeksi pasien skenario. Diuji di `front-office.test.ts`.
 */

// ---------------------------------------------------------------------------------------------------------------
// Skenario
// ---------------------------------------------------------------------------------------------------------------

function doneIn(R: RunResult, stepId: string, taskId: string): boolean {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0 || !R.def.steps[i]?.tasks.some((t) => t.id === taskId)) {
    throw new Error(`Tugas ${stepId}.${taskId} tidak ada di skenario ${R.def.id}`);
  }
  return R.done.has(taskKey(i, taskId));
}

/** Kemajuan Tn. Suryo (skenario rawat jalan) yang memengaruhi layar front office. */
export function frontOfficeProgress(R: RunResult): FrontOfficeProgress {
  return {
    ticket: doneIn(R, 'kedatangan', 'tiket'),
    called: doneIn(R, 'pendaftaran', 'panggil'),
    sep: doneIn(R, 'pendaftaran', 'sep'),
    doctorCalled: doneIn(R, 'pemeriksaan-dokter', 'panggil'),
  };
}

/** Menit sejak tengah malam (jam simulasi) → `HH.MM`. */
export function simClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
}

/** Jam selesai tugas skenario (`HH.MM`), null bila belum selesai. */
export function taskDoneAt(R: RunResult, stepId: string, taskId: string): string | null {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  const at = i < 0 ? undefined : R.doneAt.get(taskKey(i, taskId));
  return at === undefined ? null : simClock(at);
}

// ---------------------------------------------------------------------------------------------------------------
// Nomor antrean
// ---------------------------------------------------------------------------------------------------------------

/** `PD-027` → `{ code: 'PD', n: 27 }`; null bila bukan format docs/04 §5. */
export function parseQueueNo(no: string): { code: string; n: number } | null {
  const m = /^([A-Z]{1,2})-(\d{3})$/.exec(no);
  return m?.[1] && m[2] ? { code: m[1], n: Number(m[2]) } : null;
}

/** Nomor berikutnya untuk kode `code`: satu di atas nomor tertinggi yang sudah dipakai/dicadangkan. */
export function nextQueueNo(code: string, taken: readonly string[]): string {
  const max = taken.reduce((m, no) => {
    const p = parseQueueNo(no);
    return p && p.code === code ? Math.max(m, p.n) : m;
  }, 0);
  return `${code}-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Jam dan tanggal jadwal
// ---------------------------------------------------------------------------------------------------------------

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;
const BULAN_PANJANG = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

function ymd(iso: string): { y: number; m: number; d: number; wd: number } {
  const [y = 2026, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** `2026-10-05` → `Sen 5` (kepala kolom jadwal). */
export function dayShort(iso: string): string {
  const p = ymd(iso);
  return `${HARI[p.wd]?.slice(0, 3)} ${p.d}`;
}

/** `2026-10-05` → `Senin 5 Okt`. */
export function dayLong(iso: string): string {
  const p = ymd(iso);
  return `${HARI[p.wd]} ${p.d} ${BULAN[p.m - 1]}`;
}

/** `2026-10-05` → `Senin, 5 Oktober 2026` (jam dinding anjungan/TV). */
export function dateFull(iso: string): string {
  const p = ymd(iso);
  return `${HARI[p.wd]}, ${p.d} ${BULAN_PANJANG[p.m - 1]} ${p.y}`;
}

/** `2026-09-12` → `12 Sep 2026`. */
export function dateShort(iso: string): string {
  const p = ymd(iso);
  return `${p.d} ${BULAN[p.m - 1]} ${p.y}`;
}

/** Jam slot ringkas untuk sel grid: `08.00`–`12.00` → `08–12`, `09.30`–`12.00` → `09.30–12`. */
export function slotTimeShort(start: string, end: string): string {
  const s = (t: string) => t.replace(/\.00$/, '');
  return `${s(start)}–${s(end)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Kuota (F01): hampir penuh ≥ 80%, tidak bisa di bawah pasien yang sudah booking
// ---------------------------------------------------------------------------------------------------------------

export const NEARLY_FULL_PERCENT = 80;

export type QuotaLevel = 'tersedia' | 'hampir-penuh' | 'penuh';

export interface QuotaUsage {
  used: number;
  total: number;
  /** 0–100 (dibulatkan, dibatasi 100). */
  percent: number;
  level: QuotaLevel;
}

export function quotaUsage(used: number, total: number): QuotaUsage {
  const raw = total > 0 ? (used / total) * 100 : 100;
  const level: QuotaLevel = raw >= 100 ? 'penuh' : raw >= NEARLY_FULL_PERCENT ? 'hampir-penuh' : 'tersedia';
  return { used, total, percent: Math.min(100, Math.round(raw)), level };
}

export function slotUsage(q: SlotQuota): QuotaUsage {
  return quotaUsage(q.bookedJkn + q.bookedNonJkn, q.jkn + q.nonJkn);
}

export type QuotaPool = 'jkn' | 'nonJkn';

/** Batas bawah kuota satu kelompok penjamin = pasien kelompok itu yang sudah booking. */
export function quotaFloor(q: SlotQuota, pool: QuotaPool): number {
  return pool === 'jkn' ? q.bookedJkn : q.bookedNonJkn;
}

/** Ubah kuota satu kelompok; null bila hasilnya di bawah pasien yang sudah booking (atau negatif). */
export function adjustQuota(q: SlotQuota, pool: QuotaPool, delta: number): SlotQuota | null {
  const next = { ...q, [pool]: q[pool] + delta };
  if (next[pool] < 0 || next[pool] < quotaFloor(q, pool)) return null;
  return next;
}

export type SlotCellKind = 'ok' | 'full' | 'off' | 'sub' | 'none';

export interface SlotCellView {
  kind: SlotCellKind;
  time: string;
  note: string;
  /** Status untuk pembaca layar dan panel detail (status tidak hanya lewat warna). */
  status: string;
}

export const SLOT_STATUS: Record<SlotCellKind, string> = {
  ok: 'Praktik · kuota tersedia',
  full: 'Kuota hampir penuh',
  off: 'Cuti',
  sub: 'Dokter pengganti',
  none: 'Tidak praktik',
};

/** Tampilan sel grid jadwal; `quota` menimpa kuota fixture bila petugas sudah mengubahnya. */
export function slotCell(slot: ScheduleSlot, quota: SlotQuota | null, hfisSynced: boolean): SlotCellView {
  const time = slot.start && slot.end ? slotTimeShort(slot.start, slot.end) : '—';
  if (slot.kind === 'praktik' && quota) {
    const u = slotUsage(quota);
    const kind = u.level === 'tersedia' ? 'ok' : 'full';
    return { kind, time, note: `${u.used}/${u.total}`, status: SLOT_STATUS[kind] };
  }
  if (slot.kind === 'cuti') {
    return {
      kind: 'off',
      time: 'Cuti',
      note: hfisSynced ? 'HFIS diperbarui' : 'HFIS belum diubah',
      status: SLOT_STATUS.off,
    };
  }
  if (slot.kind === 'pengganti') return { kind: 'sub', time, note: 'pengganti', status: SLOT_STATUS.sub };
  return { kind: 'none', time: '—', note: 'tidak praktik', status: SLOT_STATUS.none };
}

// ---------------------------------------------------------------------------------------------------------------
// Kuota dokter hari ini di meja pendaftaran
// ---------------------------------------------------------------------------------------------------------------

export interface DeskQuotaView {
  used: number;
  total: number;
  percent: number;
  level: QuotaLevel;
  /** Kuota kelompok penjamin pasien ini sudah habis → dokter tidak bisa dipilih. */
  full: boolean;
  jknText: string;
  nonJknText: string;
}

/** Kuota satu dokter untuk penjamin `payer`; `addOne` menambah satu pasien (pendaftaran yang sedang dibuat). */
export function deskQuota(q: PractitionerQuota, payer: Payer, addOne: boolean): DeskQuotaView {
  const jkn = q.jkn.booked + (addOne && payer === 'BPJS' ? 1 : 0);
  const non = q.nonJkn.booked + (addOne && payer !== 'BPJS' ? 1 : 0);
  const pool = payer === 'BPJS' ? q.jkn : q.nonJkn;
  const u = quotaUsage(jkn + non, q.jkn.total + q.nonJkn.total);
  return {
    ...u,
    full: pool.booked >= pool.total,
    jknText: `${jkn}/${q.jkn.total}`,
    nonJknText: `${non}/${q.nonJkn.total}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rujukan dan diagnosa awal SEP
// ---------------------------------------------------------------------------------------------------------------

export function referralExpired(r: Referral, today: string): boolean {
  return r.validUntil < today;
}

export function referralMeta(r: Referral, today: string): string {
  const until = referralExpired(r, today)
    ? `berakhir ${dateShort(r.validUntil)}`
    : `berlaku s.d. ${dateShort(r.validUntil)}`;
  if (r.kind === 'surat-kontrol') return `dari kunjungan ${dateShort(r.issuedAt)} · ${until}`;
  return [r.diagnosis.code, until, r.visitNo ? `kunjungan ke-${r.visitNo}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** Galat diagnosa awal SEP: wajib diisi dan diawali kode ICD-10. String kosong = sah. */
export function diagnosisProblem(text: string): string {
  const v = text.trim();
  if (!v) return 'Diagnosa awal wajib diisi untuk SEP (kode ICD-10).';
  const code = v.split(/[\s·]/)[0] ?? '';
  if (!ICD10_PATTERN.test(code)) return 'Awali dengan kode ICD-10 yang sah, mis. I10 atau E11.9.';
  return '';
}

// ---------------------------------------------------------------------------------------------------------------
// Langkah pendaftaran (mockup Registrasi): Pasien → Penjamin → Tujuan → Konfirmasi
// ---------------------------------------------------------------------------------------------------------------

export interface RegistrationFlow {
  found: boolean;
  payer: Payer;
  /** Kepesertaan BPJS sudah dicek ke VClaim. */
  checked: boolean;
  referralChosen: boolean;
  /** Galat diagnosa awal (`diagnosisProblem`), string kosong bila sah. */
  diagnosisError: string;
  sepIssued: boolean;
  doctorChosen: boolean;
  /** Jadwal dipakai dan antrean poli terbentuk. */
  scheduleLocked: boolean;
  consent: boolean;
  done: boolean;
}

export const REGISTRATION_STEPS = ['Pasien', 'Penjamin', 'Tujuan', 'Konfirmasi'] as const;

/** Status selesai tiap langkah dan langkah aktif (indeks langkah pertama yang belum selesai; 4 = selesai). */
export function registrationProgress(f: RegistrationFlow): { done: boolean[]; active: number } {
  const s1 = f.found;
  const s2 = s1 && (f.payer !== 'BPJS' || f.sepIssued);
  const s3 = s2 && f.scheduleLocked;
  const s4 = s3 && f.done;
  const done = [s1, s2, s3, s4];
  const i = done.indexOf(false);
  return { done, active: i < 0 ? done.length : i };
}

export type PrimaryKind = 'sep' | 'tujuan' | 'selesai' | 'none';

/** Tombol utama per langkah dan alasan bila tidak bisa ditekan (selalu ditulis di samping tombol). */
export function registrationPrimary(f: RegistrationFlow): {
  kind: PrimaryKind;
  label: string;
  reason: string;
} {
  const { active } = registrationProgress(f);
  const sepLabel = 'Terbitkan SEP dan daftarkan';
  if (active === 0)
    return { kind: 'sep', label: sepLabel, reason: 'Langkah 1 belum selesai: cari pasien dulu.' };
  if (active === 1) {
    const reason = !f.checked
      ? 'Cek kepesertaan BPJS dulu.'
      : !f.referralChosen
        ? 'Pilih rujukan aktif dulu.'
        : f.diagnosisError.startsWith('Diagnosa awal wajib')
          ? 'Isi diagnosa awal dulu.'
          : f.diagnosisError
            ? 'Periksa kode ICD-10 diagnosa awal.'
            : '';
    return { kind: 'sep', label: sepLabel, reason };
  }
  if (active === 2) {
    return {
      kind: 'tujuan',
      label: 'Pakai jadwal ini dan bentuk antrean',
      reason: f.doctorChosen ? '' : 'Pilih dokter dengan kuota tersedia.',
    };
  }
  if (active === 3) {
    return {
      kind: 'selesai',
      label: 'Kirim antrean dan selesaikan',
      reason: f.consent ? '' : 'Persetujuan umum belum ditandatangani pasien.',
    };
  }
  return { kind: 'none', label: '', reason: '' };
}

// ---------------------------------------------------------------------------------------------------------------
// Papan antrean (F04): panggilan bergiliran antarpoli
// ---------------------------------------------------------------------------------------------------------------

export interface BoardClinicState {
  poliCode: string;
  current: string | null;
  waiting: string[];
  reserved: string[];
}

export interface BoardState {
  clinics: BoardClinicState[];
  calling: { queueNo: string; poliCode: string };
  history: Array<{ queueNo: string; poliCode: string }>;
}

/** Poli bisa dipanggil otomatis bila ada antrean dan nomor terdepannya tidak dicadangkan untuk petugas poli. */
export function clinicCallable(c: BoardClinicState): boolean {
  const head = c.waiting[0];
  return head !== undefined && !c.reserved.includes(head);
}

/**
 * Panggilan berikutnya: poli sesudah poli yang terakhir memanggil (bergiliran), nomor terdepannya menjadi
 * "SEDANG DIPANGGIL". Pasien baru terus datang: antrean ditambah agar minimal dua menunggu (nomor dicadangkan
 * tidak dipakai ulang). Tanpa poli yang bisa dipanggil, keadaan tidak berubah.
 */
export function boardCallNext(s: BoardState): BoardState {
  const n = s.clinics.length;
  const from = s.clinics.findIndex((c) => c.poliCode === s.calling.poliCode);
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n;
    const c = s.clinics[i];
    if (!c || !clinicCallable(c)) continue;
    const [head, ...rest] = c.waiting as [string, ...string[]];
    while (rest.length < 2) rest.push(nextQueueNo(c.poliCode, [head, ...rest, ...c.reserved]));
    const clinics = s.clinics.map((x, j) => (j === i ? { ...x, current: head, waiting: rest } : x));
    return {
      clinics,
      calling: { queueNo: head, poliCode: c.poliCode },
      history: [s.calling, ...s.history].slice(0, 4),
    };
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Anjungan (F05): keypad
// ---------------------------------------------------------------------------------------------------------------

/** Digit dikelompokkan per 4, sisa ditandai garis bawah: `2610 0501 __`. */
export function keypadDisplay(digits: string, len: number): string {
  const raw = (digits + '_'.repeat(Math.max(0, len - digits.length))).slice(0, len);
  return raw.replace(/(.{4})(?=.)/g, '$1 ');
}

export function keypadHint(digits: string, len: number): string {
  if (digits.length === 0) return `${len} digit diperlukan`;
  if (digits.length >= len) return 'Lengkap. Sentuh Lanjut.';
  return `Kurang ${len - digits.length} digit lagi`;
}
