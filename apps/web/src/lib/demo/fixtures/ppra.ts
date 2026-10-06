import type { Restriction } from '../../ppra';
import { PATIENT_ID } from './ids';
import { patientById } from './pasien';
import { STAF } from './staf';

/**
 * B08 · Data dummy PPRA (ADR-0023). Kategori restriksi = contoh kebijakan RS (bukan klasifikasi resmi); nama obat
 * generik tanpa kode (KFA dipetakan katalog obat kelak). Pasien hanya nomor RM.
 */

const rm = (id: string) => patientById(id)?.rm ?? '—';

export const RESTRICTIONS: ReadonlyArray<{ drug: string; restriction: Restriction }> = [
  { drug: 'Amoksisilin', restriction: 'bebas' },
  { drug: 'Sefazolin', restriction: 'bebas' },
  { drug: 'Seftriakson', restriction: 'pengawasan' },
  { drug: 'Siprofloksasin', restriction: 'pengawasan' },
  { drug: 'Meropenem', restriction: 'cadangan' },
  { drug: 'Vankomisin', restriction: 'cadangan' },
  { drug: 'Kolistin', restriction: 'cadangan' },
  { drug: 'Linezolid', restriction: 'cadangan' },
];

export interface AmsRequest {
  id: string;
  number: string;
  drug: string;
  regimen: string;
  rm: string;
  unit: string;
  prescriber: string;
  requestedAt: string;
  clinical: string;
  culture: string;
}

export const AMS_REQUESTS: readonly AmsRequest[] = [
  {
    id: 'ams-1',
    number: 'AB-2610-021',
    drug: 'Meropenem',
    regimen: '1 g tiap 8 jam IV',
    rm: rm(PATIENT_ID.sutan),
    unit: 'ICU',
    prescriber: 'dr. Kartika Sari, Sp.P',
    requestedAt: '2026-10-05T08:30:00+07:00',
    clinical: 'Syok septik, sumber paru; riwayat ESBL tahun lalu; norepinefrin titrasi',
    culture: 'Kultur darah dan sputum dalam inkubasi (laporan H+1)',
  },
  {
    id: 'ams-2',
    number: 'AB-2610-019',
    drug: 'Vankomisin',
    regimen: '1 g tiap 12 jam IV',
    rm: rm(PATIENT_ID.fajar),
    unit: 'Ruang Melati',
    prescriber: STAF.dpjpBedah,
    requestedAt: '2026-10-04T13:00:00+07:00',
    clinical: 'Infeksi luka operasi hari ke-6 pasca-ORIF, demam 38,6 °C',
    culture: 'Kultur pus luka: MRSA, sensitif vankomisin dan linezolid',
  },
  {
    id: 'ams-3',
    number: 'AB-2610-017',
    drug: 'Kolistin',
    regimen: '9 juta IU dosis muat, lalu 4,5 juta IU tiap 12 jam IV',
    rm: rm(PATIENT_ID.gilang),
    unit: 'ICU',
    prescriber: 'dr. Kartika Sari, Sp.P',
    requestedAt: '2026-10-04T09:00:00+07:00',
    clinical: 'Pneumonia terkait ventilator, perburukan oksigenasi',
    culture: 'Belum ada hasil kultur',
  },
];

export interface GyssensCase {
  id: string;
  rm: string;
  drug: string;
  summary: string;
}

/** Kasus audit yang belum dinilai (dinilai di layar). */
export const GYSSENS_PENDING: readonly GyssensCase[] = [
  {
    id: 'gys-1',
    rm: rm(PATIENT_ID.lestiani),
    drug: 'Seftriakson 2 g tiap 24 jam IV, hari ke-9',
    summary: 'Pneumonia komunitas membaik sejak hari ke-4, afebris 5 hari, kultur sputum flora normal',
  },
  {
    id: 'gys-2',
    rm: rm(PATIENT_ID.darmawan),
    drug: 'Sefazolin 2 g IV dosis tunggal',
    summary: 'Profilaksis bedah bersih, diberikan 40 menit sebelum insisi',
  },
];

/** Hasil audit Gyssens bulan ini yang sudah selesai (kategori). */
export const GYSSENS_DONE: readonly string[] = ['0', '0', 'IIIA', 'IVD', '0', '0', 'IIA', '0', '0', 'V'];
