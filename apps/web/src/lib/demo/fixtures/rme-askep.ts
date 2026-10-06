import type { InpatientDetail } from '@simrs/shared';
import type { NursingDx, ShiftEval } from '../../rme-askep';
import { ENCOUNTER_ID } from './ids';
import { at } from './rawat-inap';
import { STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K12 · Rencana asuhan keperawatan dari fixture Rawat inap (`nursing`), dilengkapi luaran per diagnosis. Diagnosis
 * keperawatan memakai master lokal tanpa kode resmi (keputusan fase 3 no. 15); SDKI/SLKI/SIKI diimpor bila tersedia.
 */

/** Luaran (target + kriteria) per diagnosis keperawatan master lokal. */
const OUTCOMES: ReadonlyArray<[prefix: string, outcome: string]> = [
  [
    'Risiko jatuh',
    'Tidak terjadi jatuh selama dirawat; pasien/keluarga mampu menyebutkan 3 cara pencegahan jatuh.',
  ],
  ['Ketidakstabilan kadar glukosa', 'GDS 140–180 mg/dL sebelum makan; tidak ada tanda hipoglikemia.'],
  ['Bersihan jalan napas', 'SpO2 ≥ 95% udara bebas, batuk efektif, ronki berkurang dalam 3×24 jam.'],
  ['Kelebihan volume cairan', 'Balans cairan negatif sesuai target; edema berkurang; BB turun bertahap.'],
  ['Nyeri akut', 'Skala nyeri ≤ 3; pasien mampu beristirahat.'],
];

/** Master lokal untuk menambah diagnosis keperawatan baru. */
export const NURSING_DX_MASTER: ReadonlyArray<{ label: string; outcome: string; interventions: string[] }> = [
  {
    label: 'Nyeri akut',
    outcome: 'Skala nyeri ≤ 3 dalam 24 jam; pasien mampu beristirahat.',
    interventions: [
      'Kaji nyeri (NRS) tiap shift',
      'Posisi nyaman dan relaksasi napas dalam',
      'Kolaborasi analgesik',
    ],
  },
  {
    label: 'Defisit pengetahuan',
    outcome: 'Pasien/keluarga mampu menjelaskan ulang perawatan di rumah sebelum pulang.',
    interventions: ['Kaji kesiapan belajar', 'Edukasi dengan teach-back', 'Libatkan keluarga'],
  },
  {
    label: 'Risiko infeksi',
    outcome: 'Tidak ada tanda infeksi pada area infus/luka; suhu < 37,5 °C.',
    interventions: [
      'Kebersihan tangan 5 momen',
      'Observasi area infus tiap shift',
      'Ganti balutan sesuai jadwal',
    ],
  },
  {
    label: 'Gangguan mobilitas fisik',
    outcome: 'Pasien mampu mobilisasi bertahap dengan bantuan minimal.',
    interventions: [
      'Latih rentang gerak',
      'Bantu mobilisasi bertahap',
      'Cegah dekubitus: ubah posisi tiap 2 jam',
    ],
  },
];

export function nursingPlan(d: InpatientDetail): { dxs: NursingDx[]; done: Record<string, true> } {
  const enc = d.summary.encounterId;
  const dxs = d.nursing.map((n, i) => ({
    id: `${enc}-askep-${i + 1}`,
    label: n.diagnosis,
    since: d.summary.admittedOn,
    outcome:
      OUTCOMES.find(([p]) => n.diagnosis.startsWith(p))?.[1] ?? 'Masalah teratasi sebagian dalam 3×24 jam.',
    interventions: n.interventions.map((x) => ({ id: x.id, label: x.label })),
  }));
  // Intervensi yang sudah dikerjakan di shift pagi (dari fixture `done`).
  const done = Object.fromEntries(
    d.nursing.flatMap((n, i) =>
      n.interventions
        .filter((x) => x.done)
        .map((x) => [`${enc}-askep-${i + 1}|${x.id}|pagi|${DEMO_TODAY}`, true as const]),
    ),
  );
  return { dxs, done };
}

/** Evaluasi shift malam (kemarin) yang sudah final. */
export const SHIFT_EVALS: readonly ShiftEval[] = [
  {
    id: `${ENCOUNTER_ID.endang}-eval-1`,
    dxId: `${ENCOUNTER_ID.endang}-askep-3`,
    shift: 'malam',
    date: shiftDate(DEMO_TODAY, -1),
    s: 'Sesak berkurang.',
    o: 'SpO2 96% udara bebas (koreksi 22.25), RR 20.',
    result: 'sebagian',
    p: 'Lanjut posisi semi-Fowler, latih batuk efektif.',
    by: STAF_LAIN.perawat[0],
    at: at(DEMO_TODAY, '06.40'),
  },
  {
    id: `${ENCOUNTER_ID.endang}-eval-2`,
    dxId: `${ENCOUNTER_ID.endang}-askep-1`,
    shift: 'malam',
    date: shiftDate(DEMO_TODAY, -1),
    s: '',
    o: 'Tidak ada kejadian jatuh; pagar tempat tidur terpasang.',
    result: 'sebagian',
    p: 'Lanjut bundle pencegahan jatuh.',
    by: STAF_LAIN.perawat[0],
    at: at(DEMO_TODAY, '06.45'),
  },
];

/** Perawat yang bisa menjadi pemeriksa kedua obat high-alert. */
export const SECOND_NURSES: readonly string[] = [STAF_LAIN.perawat[0], STAF_LAIN.perawat[3]];
