import type { LabValue } from '../../onkologi';
import { PATIENT_ID } from './ids';
import { PERSONA, STAF_LAIN } from './staf';

/**
 * B11 · Data dummy onkologi (ADR-0023): Ny. Maria Ulfa, kemoterapi rawat jalan (siklus 3 diklaim 24 Sep, hari ini
 * kontrol Poli PD dr. Rahmat sebelum siklus berikutnya; selaras fixture front office dan klaim). Protokol adalah
 * contoh struktur (dikonfirmasi komite farmasi dan terapi sebelum dipakai), bukan rekomendasi klinis.
 */

export const ONCOLOGY_PATIENT_ID = PATIENT_ID.maria;

export const CHEMO_PLAN = {
  diagnosis: 'Neoplasma ganas kolon (C18.9) · stadium III',
  diagnosedAt: '2026-03-12',
  regimen: 'Protokol FOLFOX (contoh)',
  intervalDays: 14,
  totalCycles: 12,
  cycle: 4,
  lastCycleDate: '2026-09-24',
  writer: 'dr. Rahmat Hidayat, Sp.PD',
  heightCm: 158,
  weightKg: 54,
  previousWeightKg: 55,
  drugs: [
    { name: 'Oksaliplatin', mgPerM2: 85, route: 'infus IV 2 jam, hari 1' },
    { name: 'Leukovorin', mgPerM2: 400, route: 'infus IV 2 jam, hari 1' },
    { name: 'Fluorourasil bolus', mgPerM2: 400, route: 'IV bolus, hari 1' },
    { name: 'Fluorourasil infus kontinu', mgPerM2: 2400, route: 'pompa infus 46 jam' },
  ],
  registry: { status: 'Terlapor ke registri kanker RS', updatedAt: '2026-03-20' },
} as const;

/** Lab pra-kemoterapi pagi ini (neutrofil di bawah ambang → gerbang). */
export const PRE_CHEMO_LABS: readonly LabValue[] = [
  { label: 'Neutrofil absolut', value: 1400, unit: '/µL', min: 1500 },
  { label: 'Trombosit', value: 162000, unit: '/µL', min: 100000 },
  { label: 'Kreatinin klirens', value: 78, unit: 'mL/menit', min: 30 },
];

export const CHEMO_VERIFIERS = [
  'dr. Rahmat Hidayat, Sp.PD',
  PERSONA.apoteker,
  STAF_LAIN.apoteker[0] ?? 'apt. Rudi Hermawan, S.Farm.',
  'Ns. Lia Kartika, S.Kep (perawat onkologi)',
] as const;
