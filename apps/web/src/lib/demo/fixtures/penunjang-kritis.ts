import type { LabSample } from '@simrs/shared';
import type { CriticalItem } from '../../penunjang-kritis';
import { DOCTOR_ID, PATIENT_ID } from './ids';
import { at, doctorName, supportPatient } from './penunjang';
import { PERSONA, STAF, STAF_LAIN } from './staf';

/**
 * S09 · Data dummy Pusat hasil kritis (ADR-0023). Nilai kritis laboratorium diturunkan dari worklist Lab yang sama
 * (termasuk pasien skenario), sehingga Tn. Yusuf dan Tn. Hartono tampil konsisten di kedua layar. Sumber lain
 * (mikrobiologi, POCT) mengikuti roster hari demo: kultur darah Ny. Siti Aminah (ICU 7) dan GDS POCT Tn. Lukman
 * (Poli PD, kini di kasir). Kode hanya dari contoh seed (LOINC 2823-3, 2345-7).
 */

const SCENARIO_PATIENTS = new Set<string>([PATIENT_ID.suryo, PATIENT_ID.hartono, PATIENT_ID.ratna]);

const fmt = (v: number, decimals: number) => v.toFixed(decimals).replace('.', ',');

/** Nilai kritis dari sampel laboratorium (hanya yang punya `critical`). */
export function criticalFromLab(s: LabSample): CriticalItem | null {
  const c = s.critical;
  if (!c) return null;
  const confirmed = c.readBackAt !== null && c.recipient !== null;
  return {
    id: `kr-${s.labNo}`,
    source: 'lab',
    unit: 'Laboratorium · kimia klinik',
    patient: s.patient,
    location: s.location,
    test: `${c.analyte} · LOINC ${c.loinc} · ${s.labNo}`,
    valueText: `${fmt(c.value, c.decimals)} ${c.unit}`,
    limitText: c.loinc === '2823-3' ? '> 6,0 mmol/L' : 'di luar batas kritis',
    raisedAt: c.resultAt,
    limitMinutes: c.limitMinutes,
    dpjp: s.sender,
    recipients: [
      { name: s.sender, role: 'DPJP' },
      { name: STAF.dokterJagaIgd, role: 'Dokter jaga' },
      { name: STAF_LAIN.perawat[0] ?? PERSONA.perawat, role: 'Perawat penanggung jawab' },
    ],
    report:
      confirmed && c.readBackAt
        ? {
            recipient: c.recipient ?? '',
            recipientRole: 'DPJP / dokter jaga',
            channel: 'telepon',
            reportedBy: PERSONA.analisLab,
            reportedAt: c.readBackAt,
            readBackConfirmed: true,
          }
        : null,
    scenario: SCENARIO_PATIENTS.has(s.patient.id),
  };
}

/** Nilai kritis hari ini di luar worklist kimia klinik (mikrobiologi, POCT). */
export function demoOtherCriticals(): CriticalItem[] {
  const aminah = supportPatient(PATIENT_ID.aminah);
  const lukman = supportPatient(PATIENT_ID.lukman);
  const rahmat = doctorName(DOCTOR_ID.rahmat);
  const andini = doctorName(DOCTOR_ID.andini);
  return [
    {
      id: 'kr-mb-0398',
      source: 'mikrobiologi',
      unit: 'Laboratorium · mikrobiologi',
      patient: aminah,
      location: 'ICU/ICCU · ICU 7',
      test: 'Kultur darah botol aerob positif · pewarnaan Gram · L2610040398',
      valueText: 'Batang Gram negatif',
      limitText: 'kultur darah positif = selalu kritis',
      raisedAt: at('08.50'),
      limitMinutes: 30,
      dpjp: rahmat,
      recipients: [{ name: rahmat, role: 'DPJP' }],
      report: {
        recipient: rahmat,
        recipientRole: 'DPJP',
        channel: 'telepon',
        reportedBy: STAF_LAIN.analis[0] ?? PERSONA.analisLab,
        reportedAt: at('09.02'),
        readBackConfirmed: true,
      },
    },
    {
      id: 'kr-poct-0847',
      source: 'lab',
      unit: 'POCT · Poli Penyakit Dalam',
      patient: lukman,
      location: 'Poli Penyakit Dalam · PD-020',
      test: 'Glukosa sewaktu (POCT) · LOINC 2345-7',
      valueText: '36 mg/dL',
      limitText: '< 40 mg/dL',
      raisedAt: at('08.47'),
      limitMinutes: 30,
      dpjp: andini,
      recipients: [{ name: andini, role: 'DPJP' }],
      report: {
        recipient: andini,
        recipientRole: 'DPJP',
        channel: 'langsung',
        reportedBy: PERSONA.perawat,
        reportedAt: at('08.53'),
        readBackConfirmed: true,
      },
    },
  ];
}

/**
 * Riwayat durasi lapor 7 hari terakhir (menit; 28 Sep–4 Okt) untuk metrik kepatuhan. Dua laporan melewati batas
 * 30 menit (shift malam), sumber tinjauan komite mutu.
 */
export const CRITICAL_HISTORY_7D: readonly number[] = [
  6, 8, 9, 11, 12, 7, 14, 18, 22, 9, 10, 5, 13, 16, 19, 25, 28, 34, 8, 11, 12, 6, 41, 15, 17, 9, 10, 21, 7,
  12,
];

/** Aturan batas kritis aktif (dari pengaturan; ditampilkan sebagai acuan). */
export const CRITICAL_RULES: ReadonlyArray<{ test: string; rule: string }> = [
  { test: 'Kalium · LOINC 2823-3', rule: '< 2,5 atau > 6,0 mmol/L' },
  { test: 'Natrium · LOINC 2951-2', rule: '< 120 atau > 160 mmol/L' },
  { test: 'Glukosa sewaktu · LOINC 2345-7', rule: '< 40 atau > 500 mg/dL' },
  { test: 'Hemoglobin · LOINC 718-7', rule: '< 7 atau > 20 g/dL' },
  { test: 'Trombosit · LOINC 777-3', rule: '< 20.000/µL' },
  { test: 'Kultur darah', rule: 'setiap pertumbuhan / Gram positif' },
  { test: 'Radiologi', rule: 'temuan kritis dari ekspertise (mis. pneumotoraks)' },
];
