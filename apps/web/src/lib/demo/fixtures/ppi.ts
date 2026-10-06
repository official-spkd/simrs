import type { BundleDef, HaiType, HhAction, HhObservation, IsolationRoom, Precaution } from '../../ppi';
import { PATIENT_ID } from './ids';
import { patientById } from './pasien';

/**
 * B07 · Data dummy PPI Oktober 2026 s.d. hari demo (ADR-0023). Kasus hanya menampilkan nomor RM dan unit (PHI
 * minimal). Observasi kebersihan tangan dan audit APD adalah data transaksi yang juga dihitung ulang di layar Mutu
 * (INM-01 = 88% seperti Dasbor direksi, INM-02 = 96%).
 */

const rm = (id: string) => patientById(id)?.rm ?? '—';

export const HAI_MONTH: Record<HaiType, { cases: number; denominator: number }> = {
  isk: { cases: 1, denominator: 312 },
  ido: { cases: 1, denominator: 64 },
  vap: { cases: 1, denominator: 128 },
  phlebitis: { cases: 3, denominator: 1180 },
};

export interface HaiSuspect {
  id: string;
  type: HaiType;
  rm: string;
  unit: string;
  flaggedAt: string;
  trigger: string;
}

export const HAI_SUSPECTS: readonly HaiSuspect[] = [
  {
    id: 'sus-1',
    type: 'vap',
    rm: rm(PATIENT_ID.sutan),
    unit: 'ICU',
    flaggedAt: '2026-10-05T06:10:00+07:00',
    trigger: 'Ventilator hari ke-4 · infiltrat baru di foto toraks · FiO₂ naik dari 40% ke 60%',
  },
  {
    id: 'sus-2',
    type: 'phlebitis',
    rm: rm(PATIENT_ID.endang),
    unit: 'Ruang Melati',
    flaggedAt: '2026-10-05T08:20:00+07:00',
    trigger: 'Catatan perawat: kemerahan dan nyeri di lokasi infus tangan kiri, skor VIP 2',
  },
  {
    id: 'sus-3',
    type: 'isk',
    rm: rm(PATIENT_ID.darmawan),
    unit: 'Ruang Melati',
    flaggedAt: '2026-10-04T22:40:00+07:00',
    trigger: 'Kateter urine hari ke-3 · suhu 38,4 °C · kultur urine masih diproses',
  },
];

const PROFESSIONS: ReadonlyArray<{ profession: string; total: number; done: number }> = [
  { profession: 'Perawat', total: 200, done: 182 },
  { profession: 'Dokter', total: 120, done: 98 },
  { profession: 'Bidan', total: 40, done: 36 },
  { profession: 'Penunjang', total: 40, done: 36 },
];

/** 400 peluang 5 momen bulan berjalan (deterministik); 352 dilakukan = 88%. */
export function handHygieneObservations(): HhObservation[] {
  const out: HhObservation[] = [];
  for (const p of PROFESSIONS) {
    for (let i = 0; i < p.total; i++) {
      const action: HhAction = i < p.done ? (i % 3 === 0 ? 'cuci' : 'handrub') : 'tidak';
      out.push({ profession: p.profession, moment: i % 5, action });
    }
  }
  return out;
}

/** Audit APD bulan berjalan: 200 pengamatan, 192 sesuai = 96%. */
export function ppeAudits(): Array<{ unit: string; compliant: boolean }> {
  const units = ['ICU', 'IGD', 'Ruang Melati', 'Kamar operasi'];
  return Array.from({ length: 200 }, (_, i) => ({
    unit: units[i % units.length] ?? 'ICU',
    compliant: i >= 8,
  }));
}

export const BUNDLES: readonly BundleDef[] = [
  {
    id: 'vap',
    label: 'Bundle VAP',
    elements: [
      'Elevasi kepala 30–45°',
      'Kebersihan mulut dengan klorheksidin',
      'Evaluasi sedasi harian',
      'Profilaksis ulkus peptikum',
      'Profilaksis trombosis vena dalam',
    ],
  },
  {
    id: 'isk',
    label: 'Bundle ISK kateter',
    elements: [
      'Indikasi pemasangan sesuai',
      'Pemasangan aseptik',
      'Kantong urine di bawah kandung kemih',
      'Evaluasi harian kebutuhan kateter',
    ],
  },
  {
    id: 'ido',
    label: 'Bundle IDO',
    elements: [
      'Antibiotik profilaksis ≤ 60 menit sebelum insisi',
      'Pencukuran dengan clipper (bukan pisau)',
      'Suhu tubuh normal perioperatif',
      'Glukosa darah terkontrol',
    ],
  },
];

/** Audit bundle bulan berjalan per bundle: jumlah audit dan yang patuh (all-or-none). */
export const BUNDLE_AUDITS: Record<string, { total: number; compliant: number }> = {
  vap: { total: 12, compliant: 8 },
  isk: { total: 20, compliant: 18 },
  ido: { total: 15, compliant: 14 },
};

export const ISOLATION_ROOMS: readonly IsolationRoom[] = [
  {
    id: 'iso-1',
    label: 'Isolasi 1 · tekanan negatif',
    negativePressure: true,
    occupiedBy: rm(PATIENT_ID.fajar),
  },
  { id: 'iso-2', label: 'Isolasi 2 · tekanan negatif', negativePressure: true, occupiedBy: null },
  { id: 'iso-3', label: 'Isolasi 3 · standar', negativePressure: false, occupiedBy: null },
  { id: 'iso-4', label: 'Isolasi 4 · standar', negativePressure: false, occupiedBy: rm(PATIENT_ID.gilang) },
];

export interface IsolationRequest {
  id: string;
  rm: string;
  unit: string;
  reason: string;
  precaution: Precaution;
  requestedAt: string;
}

export const ISOLATION_REQUESTS: readonly IsolationRequest[] = [
  {
    id: 'iso-req-1',
    rm: rm(PATIENT_ID.sumarni),
    unit: 'Ruang Melati',
    reason: 'Kultur luka: MRSA positif',
    precaution: 'kontak',
    requestedAt: '2026-10-05T09:30:00+07:00',
  },
  {
    id: 'iso-req-2',
    rm: rm(PATIENT_ID.joko),
    unit: 'IGD',
    reason: 'Suspek TB paru: batuk 3 minggu, BTA dalam proses',
    precaution: 'airborne',
    requestedAt: '2026-10-05T10:05:00+07:00',
  },
];
