import type { SystemRoleCode } from '@simrs/shared';

/**
 * Mesin skenario presentasi (ADR-0023): port 1:1 mesin replay `design/mockups/Simulasi.dc.html`. Keadaan hanya
 * berupa urutan kejadian; semua yang tampil (rekam medis, jejak sistem, tagihan, jam) dihitung ulang dari definisi
 * skenario + urutan itu, jadi deterministik dan bisa divalidasi ulang.
 */

export type ScenarioId = 'rawat-jalan' | 'igd-ranap' | 'elektif-btn';

/** Nilai tugas: `true` untuk tugas aksi, id opsi untuk pilihan, teks untuk isian. */
export type TaskValue = true | string;

/** Rekam medis yang terbentuk selama skenario (semua fiktif). Uang dalam rupiah `bigint`. */
export interface ScenarioRecord {
  nama: string;
  initials: string;
  jk: 'L' | 'P';
  umur: number;
  rm: string;
  alergi: string;
  riwayat: string;
  penjamin: string;
  lokasi: string;
  sep: string;
  antrean: string;
  ttv: string;
  triase: string;
  dx: string[];
  order: string[];
  hasil: string[];
  obat: string[];
  tindakan: string[];
  kontrol: string;
  klaim: string;
  bayarPasien: bigint | null;
  /** Menit simulasi saat pasien pulang. */
  pulangAt: number | null;
  /** Catatan pembayaran dan pembiayaan (skenario elektif). */
  bayar: string[];
  biaya: string[];
  deposit: bigint;
  dibiayai: bigint;
  piutangBiaya: bigint;
  lunasQris: bigint;
  selisih: bigint;
  // Keputusan yang memengaruhi langkah berikutnya.
  prb?: boolean;
  dispo?: string;
  bed?: string;
  ppi?: string;
  dxUtama?: string;
  vip?: boolean;
  kanal?: string;
  cara?: string;
  tenor?: string;
  ajukan?: boolean;
}

export interface TaskOption {
  id: string;
  label: string;
  sub?: string;
}

export interface ApplyContext {
  /** Menit simulasi saat tugas selesai. */
  now: number;
  /** Label opsi terpilih (tugas pilihan). */
  opt: string;
  optSub: string;
  log(text: string, sys?: string): void;
  charge(name: string, amount: bigint): void;
}

type DoneLookup = (taskId: string) => TaskValue | undefined;

interface TaskBase {
  id: string;
  label: string;
  hint?: string;
  /** `danger` = gerbang keselamatan; `warn` = perhatian. */
  tone?: 'danger' | 'warn';
  /** Tugas hanya tampil bila syarat terpenuhi (dievaluasi terhadap rekam medis akhir + tugas langkah yang sama). */
  when?: (r: ScenarioRecord, done: DoneLookup) => boolean;
  /** Menit kerja; boleh bergantung pada nilai (mis. bed yang masih dibersihkan). */
  dur: number | ((v: TaskValue) => number);
  apply?: (r: ScenarioRecord, v: TaskValue, c: ApplyContext) => void;
}

export interface ActTask extends TaskBase {
  kind: 'act';
  btn: string;
  result?: string | ((r: ScenarioRecord) => string);
}

export interface ChoiceTask extends TaskBase {
  kind: 'choice';
  options: readonly TaskOption[] | ((r: ScenarioRecord) => readonly TaskOption[]);
  /** Pilihan bawaan saat putar otomatis (selain itu opsi pertama). */
  def?: string;
}

export interface InputTask extends TaskBase {
  kind: 'input';
  def: string;
  ph: string;
  /** Pesan galat, atau string kosong bila sah. */
  check: (v: string) => string;
}

export type ScenarioTask = ActTask | ChoiceTask | InputTask;

export interface ScenarioStep {
  /** Kunci stabil langkah (dipakai milestone `langkah.tugas`). */
  id: string;
  stage: string;
  actor: string;
  /** Posisi akun demo yang membawakan langkah ini; null = bukan staf (pasien/sistem). */
  role: SystemRoleCode | null;
  /** Id layar di registri `SCREENS` yang menampilkan langkah ini. */
  screen: string;
  title: string;
  desc: string;
  /** Menit jeda sebelum langkah dimulai. */
  wait: number;
  tasks: readonly ScenarioTask[];
}

export interface ExtraStat {
  label: string;
  value: bigint;
  note: string;
}

export interface ScenarioDef {
  id: ScenarioId;
  /** Label tab skenario. */
  label: string;
  /** Nama skenario di banner pasien, judul ringkasan, dan "Coba skenario …" (mockup `D.label`); bawaan `label`. */
  name?: string;
  /** Tanggal mulai `YYYY-MM-DD` (fiktif). */
  startDate: string;
  /** Menit sejak tengah malam saat skenario dimulai. */
  startMin: number;
  /** Tampilkan nama hari pada jam (skenario lintas hari). */
  showDay: boolean;
  base: ScenarioRecord;
  auto: readonly string[];
  extra?: (r: ScenarioRecord) => ExtraStat[];
  steps: readonly ScenarioStep[];
}

/** Kejadian tersimpan: tugas selesai `{s, t, v}` atau pindah langkah `{adv}` (`adv = jumlah langkah` = selesai). */
export type ScenarioEvent = { s: number; t: string; v: TaskValue } | { adv: number };

export interface LogEntry {
  t: number;
  actor: string;
  text: string;
  sys: string;
}

export interface ChargeLine {
  name: string;
  amount: bigint;
  /** Tahap asal (charge capture). */
  src: string;
}

export interface RunResult {
  def: ScenarioDef;
  rec: ScenarioRecord;
  logs: LogEntry[];
  charges: ChargeLine[];
  clock: number;
  /** Menit jeda dan kerja per langkah. */
  per: Array<{ wait: number; svc: number }>;
  stepStart: Array<number | null>;
  /** Nilai tugas selesai, kunci `<indeks langkah>.<id tugas>`. */
  done: Map<string, TaskValue>;
  /** Menit selesai tiap tugas, kunci sama dengan `done`. */
  doneAt: Map<string, number>;
  /** Langkah aktif (indeks). */
  step: number;
  finished: boolean;
}

export type ScenarioAction =
  | { type: 'task'; step: number; task: string; value: TaskValue }
  | { type: 'next' }
  /** Satu langkah putar otomatis: kerjakan tugas terbuka dengan nilai bawaan, atau pindah langkah. */
  | { type: 'auto' };
