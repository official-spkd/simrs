import type { ClinicalResult } from '@simrs/shared';
import type { SummaryMed, SummaryVisit } from '../../rme-ringkasan';
import { DOCTOR_ID, ENCOUNTER_ID } from './ids';
import { at } from './rawat-inap';
import type { RmeChart } from './rme-pasien';
import { doctorById, STAF } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K14 · Data ringkasan pasien di luar fixture rawat inap: hasil terbaru (kalium kritis Tn. Yusuf 10.39, selaras
 * roster dan worklist), obat aktif pasien rawat jalan, dan kunjungan terakhir lintas unit.
 */

const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);
const E = ENCOUNTER_ID;
const doc = (id: string) => doctorById(id)?.nama ?? '';

export const EXTRA_RESULTS: Readonly<Record<string, readonly ClinicalResult[]>> = {
  [E.yusuf]: [{ at: T('10.39'), name: 'Kalium', value: '6,4 mmol/L', flag: 'kritis' }],
  [E.sutan]: [
    { at: T('06.00'), name: 'Kreatinin', value: '1,6 mg/dL (eGFR 42)', flag: 'tinggi' },
    { at: T('22.00', -1), name: 'Troponin I', value: '0,04 ng/mL', flag: 'normal' },
  ],
  [E.rohana]: [{ at: T('08.10'), name: 'Gula darah sewaktu', value: '198 mg/dL', flag: 'tinggi' }],
  [E.maria]: [
    { at: T('10.20'), name: 'Hemoglobin', value: '8,9 g/dL', flag: 'rendah' },
    { at: T('10.20'), name: 'Leukosit', value: '3.100 /µL', flag: 'rendah' },
    { at: T('10.20'), name: 'Trombosit', value: '168.000 /µL', flag: 'normal' },
  ],
};

export const OUTPATIENT_MEDS: Readonly<Record<string, readonly SummaryMed[]>> = {
  [E.rohana]: [
    { name: 'Metformin 500 mg', sig: 'PO · 2×1 sesudah makan', highAlert: false },
    { name: 'Insulin glargine 12 unit', sig: 'SC · 1×/hari malam', highAlert: true },
  ],
  [E.darmawan]: [
    { name: 'Alopurinol 100 mg', sig: 'PO · 1×1', highAlert: false },
    { name: 'Lansoprazol 30 mg', sig: 'PO · 1×1 sebelum makan', highAlert: false },
  ],
  [E.dewi]: [{ name: 'Antasida suspensi', sig: 'PO · 3×1 sendok takar', highAlert: false }],
  [E.sutan]: [
    { name: 'Klopidogrel 75 mg', sig: 'PO · 1×1', highAlert: false },
    { name: 'Atorvastatin 40 mg', sig: 'PO · 1×1 malam', highAlert: false },
    { name: 'Enoksaparin 60 mg', sig: 'SC · 2×1 (ditahan CDS dosis ginjal)', highAlert: true },
  ],
};

export function recentVisits(chart: RmeChart): SummaryVisit[] {
  const enc = chart.encounterId;
  const now: SummaryVisit = {
    date: chart.startedOn,
    kind: chart.setting === 'rawat-inap' ? 'Rawat inap (berjalan)' : 'Kunjungan hari ini',
    unit: chart.lokasi,
    doctor: chart.dpjp,
    note: 'Kunjungan aktif',
  };
  const past: Readonly<Record<string, readonly SummaryVisit[]>> = {
    [E.endang]: [
      {
        date: '2026-08-18',
        kind: 'Rawat jalan',
        unit: 'Poli Penyakit Dalam',
        doctor: STAF.dpjpPenyakitDalam,
        note: 'Kontrol DM, HbA1c 8,4%',
      },
    ],
    [E.rohana]: [
      {
        date: '2026-09-14',
        kind: 'Rawat inap',
        unit: 'Bangsal Melati',
        doctor: STAF.dpjpPenyakitDalam,
        note: 'Pneumonia komunitas, pulang 19 Sep',
      },
    ],
    [E.yusuf]: [
      {
        date: shiftDate(DEMO_TODAY, -4),
        kind: 'Hemodialisis rutin',
        unit: 'Unit Hemodialisis',
        doctor: doc(DOCTOR_ID.sinta),
        note: 'HD sesi 2×/minggu',
      },
    ],
  };
  return [now, ...(past[enc] ?? [])];
}
