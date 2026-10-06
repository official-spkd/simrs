import type { Impact } from '../../aset';

/**
 * B02 · Data dummy aset dan pemeliharaan (ADR-0023). Merek tidak disebut (nama generik), nilai perolehan rupiah
 * bigint dalam string, lembaga kalibrasi generik. Hari demo Sen, 5 Okt 2026.
 */

export interface Asset {
  id: string;
  code: string;
  name: string;
  category: 'Alat medis' | 'Penunjang gedung';
  location: string;
  acquired: string;
  /** Rupiah, bigint dalam string. */
  cost: string;
  lifeYears: number;
  lastCalibration: string | null;
  /** null = tidak wajib kalibrasi. */
  nextCalibration: string | null;
  nextMaintenance: string;
}

export const ASSETS: readonly Asset[] = [
  {
    id: 'ast-01',
    code: 'AST-ALK-0112',
    name: 'Ventilator ICU',
    category: 'Alat medis',
    location: 'ICU bed 3',
    acquired: '2022-03-15',
    cost: '485000000',
    lifeYears: 8,
    lastCalibration: '2025-10-20',
    nextCalibration: '2026-10-20',
    nextMaintenance: '2026-10-12',
  },
  {
    id: 'ast-02',
    code: 'AST-ALK-0118',
    name: 'Defibrilator',
    category: 'Alat medis',
    location: 'IGD resusitasi',
    acquired: '2021-07-01',
    cost: '128000000',
    lifeYears: 7,
    lastCalibration: '2025-09-28',
    nextCalibration: '2026-09-28',
    nextMaintenance: '2026-10-09',
  },
  {
    id: 'ast-03',
    code: 'AST-ALK-0131',
    name: 'Monitor pasien 5 parameter',
    category: 'Alat medis',
    location: 'Ruang Melati M-201',
    acquired: '2023-01-10',
    cost: '96500000',
    lifeYears: 7,
    lastCalibration: '2026-02-14',
    nextCalibration: '2027-02-14',
    nextMaintenance: '2026-11-02',
  },
  {
    id: 'ast-04',
    code: 'AST-ALK-0140',
    name: 'Syringe pump',
    category: 'Alat medis',
    location: 'ICU bed 5',
    acquired: '2024-05-20',
    cost: '42000000',
    lifeYears: 6,
    lastCalibration: '2025-11-02',
    nextCalibration: '2026-11-02',
    nextMaintenance: '2026-10-30',
  },
  {
    id: 'ast-05',
    code: 'AST-ALK-0152',
    name: 'USG portabel',
    category: 'Alat medis',
    location: 'Poli Kebidanan',
    acquired: '2020-11-03',
    cost: '310000000',
    lifeYears: 8,
    lastCalibration: '2026-04-11',
    nextCalibration: '2027-04-11',
    nextMaintenance: '2026-12-01',
  },
  {
    id: 'ast-06',
    code: 'AST-ALK-0163',
    name: 'Autoklaf uap',
    category: 'Alat medis',
    location: 'CSSD',
    acquired: '2019-08-19',
    cost: '575000000',
    lifeYears: 10,
    lastCalibration: '2026-01-08',
    nextCalibration: '2027-01-08',
    nextMaintenance: '2026-10-07',
  },
  {
    id: 'ast-07',
    code: 'AST-ALK-0177',
    name: 'Timbangan bayi digital',
    category: 'Alat medis',
    location: 'Ruang bersalin',
    acquired: '2023-06-02',
    cost: '7800000',
    lifeYears: 5,
    lastCalibration: '2025-09-15',
    nextCalibration: '2026-09-15',
    nextMaintenance: '2026-10-15',
  },
  {
    id: 'ast-08',
    code: 'AST-GDG-0021',
    name: 'Genset 500 kVA',
    category: 'Penunjang gedung',
    location: 'Rumah genset',
    acquired: '2018-02-01',
    cost: '1250000000',
    lifeYears: 15,
    lastCalibration: null,
    nextCalibration: null,
    nextMaintenance: '2026-10-06',
  },
  {
    id: 'ast-09',
    code: 'AST-GDG-0034',
    name: 'Tata udara kamar operasi (HEPA)',
    category: 'Penunjang gedung',
    location: 'Kamar operasi 1',
    acquired: '2020-01-15',
    cost: '420000000',
    lifeYears: 12,
    lastCalibration: '2026-03-03',
    nextCalibration: '2026-10-25',
    nextMaintenance: '2026-10-25',
  },
];

export const TECHNICIANS = [
  'Agus Prasetyo (teknisi elektromedis)',
  'Wawan Setiadi (teknisi elektromedis)',
  'Joko Purnomo (teknisi gedung)',
] as const;

export interface RepairTicket {
  id: string;
  number: string;
  assetId: string;
  unit: string;
  reporter: string;
  complaint: string;
  impact: Impact;
  reportedAt: string;
  /** 0 dilaporkan, 1 diterima, 2 dikerjakan. */
  stage: 0 | 1 | 2;
  technician: string | null;
  respondedAt: string | null;
}

export const REPAIR_TICKETS: readonly RepairTicket[] = [
  {
    id: 'tkt-1',
    number: 'WO-2610-041',
    assetId: 'ast-03',
    unit: 'Ruang Melati',
    reporter: 'Ns. Rosa Elvira, S.Kep',
    complaint: 'Sensor SpO₂ membaca 0 walau terpasang benar; alarm tidak berbunyi',
    impact: 'sedang',
    reportedAt: '2026-10-05T09:40:00+07:00',
    stage: 0,
    technician: null,
    respondedAt: null,
  },
  {
    id: 'tkt-2',
    number: 'WO-2610-038',
    assetId: 'ast-04',
    unit: 'ICU',
    reporter: 'Ns. Galih Saputra, S.Kep',
    complaint: 'Alarm oklusi muncul berulang pada laju 2 mL/jam',
    impact: 'kritis',
    reportedAt: '2026-10-05T07:15:00+07:00',
    stage: 1,
    technician: 'Agus Prasetyo (teknisi elektromedis)',
    respondedAt: '2026-10-05T07:50:00+07:00',
  },
  {
    id: 'tkt-3',
    number: 'WO-2610-033',
    assetId: 'ast-06',
    unit: 'CSSD',
    reporter: 'Kepala CSSD',
    complaint:
      'Tekanan tidak mencapai 2,1 bar pada siklus 134 °C; sterilisasi dialihkan ke autoklaf cadangan',
    impact: 'kritis',
    reportedAt: '2026-10-03T13:00:00+07:00',
    stage: 2,
    technician: 'Wawan Setiadi (teknisi elektromedis)',
    respondedAt: '2026-10-03T15:30:00+07:00',
  },
];

export const CALIBRATION_LABS = [
  'Balai pengamanan fasilitas kesehatan',
  'Laboratorium kalibrasi terakreditasi (LK-031)',
] as const;
