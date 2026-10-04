import {
  type EncounterLab,
  POLI_VISIT_STAGES,
  type PoliQueueItem,
  type PoliQueueStatus,
  type PoliVital,
} from '@simrs/shared';

/** K01/K02 · Fungsi murni tampilan pemeriksaan poli (filter antrean, tahapan, tanda vital, kode diagnosis). */

/** Pilihan ICD-10 di pemilih diagnosis: HANYA dari rujukan seed (`SEED_REF_SAMPLES`, dijaga tes). */
export const ICD10_OPTIONS: ReadonlyArray<{ code: string; display: string }> = [
  { code: 'I10', display: 'Hipertensi esensial (primer)' },
  { code: 'E11.9', display: 'Diabetes melitus tipe 2 tanpa komplikasi' },
  { code: 'E78.5', display: 'Hiperlipidemia, tidak spesifik' },
  { code: 'M10.9', display: 'Gout, tidak spesifik' },
  { code: 'K30', display: 'Dispepsia' },
  { code: 'R50.9', display: 'Demam, tidak spesifik' },
  { code: 'J06.9', display: 'Infeksi saluran napas atas akut' },
  { code: 'J18.9', display: 'Pneumonia, tidak spesifik' },
  { code: 'N18.3', display: 'Penyakit ginjal kronik stadium 3' },
  { code: 'I20.0', display: 'Angina tidak stabil' },
  { code: 'I21.4', display: 'Infark miokard akut non-ST elevasi' },
  { code: 'E87.5', display: 'Hiperkalemia' },
];

export function icd10Display(code: string): string | undefined {
  return ICD10_OPTIONS.find((o) => o.code === code)?.display;
}

/** Posisi yang menulis CPPT dokter (SOAP + diagnosis) dan order/resep CPOE. */
const DOCTOR_ROLES: readonly string[] = ['dokter', 'dokter_residen'];
/** Posisi yang mengisi asesmen awal keperawatan dan tanda vital poli. */
const NURSE_ROLES: readonly string[] = ['perawat', 'bidan'];

/** CPPT dokter (SOAP + diagnosis ICD-10): dokter dan dokter residen. Dipakai layar dan Server Action. */
export function canWriteDoctorNote(role: string | null | undefined): boolean {
  return DOCTOR_ROLES.includes(role ?? '');
}

/** Order penunjang dan resep (CPOE, termasuk order cepat skenario): dokter dan dokter residen. */
export function canWriteOrders(role: string | null | undefined): boolean {
  return DOCTOR_ROLES.includes(role ?? '');
}

/** Asesmen awal keperawatan dan tanda vital poli: perawat dan bidan. */
export function canRecordVitals(role: string | null | undefined): boolean {
  return NURSE_ROLES.includes(role ?? '');
}

/**
 * CPPT dokter residen belum final sampai di-co-sign DPJP (selaras CPPT rawat inap `cosignRequired` untuk residen):
 * tanda tangan residen menyimpan catatan berstatus "menunggu co-sign DPJP", bukan menyelesaikan kunjungan.
 */
export function cpptNeedsCosign(role: string | null | undefined): boolean {
  return role === 'dokter_residen';
}

export const QUEUE_STATUS_LABEL: Record<PoliQueueStatus, string> = {
  menunggu: 'Menunggu',
  diperiksa: 'Diperiksa',
  'menunggu-hasil': 'Menunggu hasil',
  dijeda: 'Dijeda',
  selesai: 'Selesai',
};

export type QueueFilter = 'semua' | 'menunggu' | 'hasil';

export const QUEUE_FILTERS: ReadonlyArray<{ id: QueueFilter; label: string }> = [
  { id: 'semua', label: 'Semua' },
  { id: 'menunggu', label: 'Menunggu' },
  { id: 'hasil', label: 'Hasil' },
];

type StatusOf = (item: PoliQueueItem) => PoliQueueStatus;
const ownStatus: StatusOf = (i) => i.status;

export function queueCounts(
  items: readonly PoliQueueItem[],
  statusOf: StatusOf = ownStatus,
): Record<QueueFilter, number> {
  return {
    semua: items.length,
    menunggu: items.filter((i) => statusOf(i) === 'menunggu').length,
    hasil: items.filter((i) => statusOf(i) === 'menunggu-hasil').length,
  };
}

/** Filter chip + pencarian nama / No. RM (dengan atau tanpa tanda hubung) / nomor antrean. */
export function filterQueue(
  items: readonly PoliQueueItem[],
  filter: QueueFilter,
  query: string,
  statusOf: StatusOf = ownStatus,
): PoliQueueItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => {
    const s = statusOf(i);
    if (filter === 'menunggu' && s !== 'menunggu') return false;
    if (filter === 'hasil' && s !== 'menunggu-hasil') return false;
    if (!q) return true;
    const hay = `${i.name} ${i.rm} ${i.rm.replace(/-/g, '')} ${i.queueNo}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Pasien menunggu berikutnya (urut nomor antrean). */
export function nextWaiting(
  items: readonly PoliQueueItem[],
  statusOf: StatusOf = ownStatus,
): PoliQueueItem | undefined {
  return [...items]
    .sort((a, b) => a.queueNo.localeCompare(b.queueNo))
    .find((i) => statusOf(i) === 'menunggu');
}

export interface StageView {
  label: string;
  state: 'selesai' | 'aktif' | 'belum';
}

export function stageSteps(stage: number): StageView[] {
  return POLI_VISIT_STAGES.map((label, i) => ({
    label,
    state: i < stage ? 'selesai' : i === stage ? 'aktif' : 'belum',
  }));
}

/** Menit sejak tengah malam → `07.10`. */
export function minutesToJam(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
}

/** Tekanan darah `138/86` → angka, atau null bila format salah. */
export function parseBloodPressure(v: string): { sys: number; dia: number } | null {
  const m = /^(\d{2,3})\/(\d{2,3})$/.exec(v.trim());
  return m ? { sys: Number(m[1]), dia: Number(m[2]) } : null;
}

/** Hipertensi bila sistolik ≥ 140 atau diastolik ≥ 90; hipotensi bila sistolik < 90. */
export function bloodPressureFlag(sys: number, dia: number): PoliVital['flag'] {
  if (sys >= 140 || dia >= 90) return 'tinggi';
  if (sys < 90) return 'rendah';
  return 'normal';
}

/** GDS ≥ 200 mg/dL tinggi (ditandai untuk dokter), < 70 rendah. */
export function glucoseFlag(mgdl: number): PoliVital['flag'] {
  if (mgdl >= 200) return 'tinggi';
  if (mgdl < 70) return 'rendah';
  return 'normal';
}

export const VITAL_FLAG_LABEL: Record<PoliVital['flag'], string> = {
  normal: 'Normal',
  tinggi: 'Tinggi',
  rendah: 'Rendah',
  belum: 'Belum diukur',
};

export const LAB_FLAG_LABEL: Record<EncounterLab['flag'], string> = {
  '': 'Normal',
  H: 'Tinggi',
  L: 'Rendah',
  A: 'Abnormal',
  K: 'Kritis',
};
