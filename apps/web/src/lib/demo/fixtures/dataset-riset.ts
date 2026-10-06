import type { CohortRow, DatasetField } from '../../dataset-riset';
import { PERSONA, STAF } from './staf';

/**
 * I11 · Data dummy permintaan dataset riset (ADR-0023). Kohort sintetis (bukan pasien mana pun), wilayah generik
 * fiktif; jejak akses hanya contoh.
 */

export const DATASET_REQUEST = {
  number: 'DSR-2610-003',
  title: 'Luaran pasien DM tipe 2 dengan hipoglikemia berat, 2024–2026',
  requester: STAF.dpjpPenyakitDalam,
  institution: 'Bagian ilmu penyakit dalam (riset internal)',
  submittedAt: '2026-09-28T10:00:00+07:00',
  purpose: 'Studi kohort retrospektif faktor risiko hipoglikemia berat',
  period: 'Jan 2024 – Sep 2026',
} as const;

export const DATASET_FIELDS: readonly DatasetField[] = [
  { key: 'name', label: 'Nama pasien', kind: 'pengenal' },
  { key: 'rm', label: 'Nomor RM', kind: 'pengenal' },
  { key: 'nik', label: 'NIK', kind: 'pengenal' },
  { key: 'phone', label: 'Nomor telepon', kind: 'pengenal' },
  { key: 'age', label: 'Umur', kind: 'kuasi' },
  { key: 'sex', label: 'Jenis kelamin', kind: 'kuasi' },
  { key: 'district', label: 'Kecamatan domisili', kind: 'kuasi' },
  { key: 'hba1c', label: 'HbA1c terakhir', kind: 'klinis' },
  { key: 'episodes', label: 'Jumlah episode hipoglikemia', kind: 'klinis' },
  { key: 'insulin', label: 'Terapi insulin (ya/tidak)', kind: 'klinis' },
];

const DISTRICTS: ReadonlyArray<readonly [string, string]> = [
  ['Kecamatan A1', 'Kota A'],
  ['Kecamatan A2', 'Kota A'],
  ['Kecamatan A3', 'Kota A'],
  ['Kecamatan B1', 'Kota B'],
  ['Kecamatan B2', 'Kota B'],
];

/** 60 baris kohort sintetis (deterministik). */
export function cohort(): CohortRow[] {
  return Array.from({ length: 60 }, (_, i) => {
    const [district, city] = DISTRICTS[(i * 7) % DISTRICTS.length] ?? ['Kecamatan A1', 'Kota A'];
    return { age: 40 + ((i * 13) % 30), sex: i % 3 === 0 ? 'L' : 'P', district, city };
  });
}

export const DATASET_APPROVERS = [STAF.dpjpPenyakitDalam, PERSONA.petugasPrivasi, PERSONA.direktur] as const;

export const ACCESS_LOG_SEED: ReadonlyArray<{ at: string; who: string; action: string }> = [
  { at: '2026-09-28T10:00:00+07:00', who: STAF.dpjpPenyakitDalam, action: 'Mengajukan permintaan dataset' },
  {
    at: '2026-09-30T14:20:00+07:00',
    who: 'Sekretariat komite etik',
    action: 'Mengunggah dokumen persetujuan etik',
  },
];
