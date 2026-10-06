import type { RegDoc } from '../../dokumen';
import { PERSONA } from './staf';

/**
 * B12 · Data dummy dokumen regulasi dan akreditasi (ADR-0023). Nomor dokumen fiktif per jenis; bab akreditasi
 * memakai singkatan bab standar akreditasi RS; jumlah elemen MRMIK = 51 (docs/03).
 */

export const REG_DOCS: readonly RegDoc[] = [
  {
    id: 'doc-kep-014-v2',
    code: 'SPO-KEP-014',
    title: 'SPO pemasangan dan perawatan kateter urine',
    kind: 'SPO',
    version: 2,
    status: 'terbit',
    owner: 'Komite keperawatan',
    author: PERSONA.perawat,
    publishedAt: '2023-11-20',
    reviewDue: '2026-11-20',
  },
  {
    id: 'doc-kep-014-v3',
    code: 'SPO-KEP-014',
    title: 'SPO pemasangan dan perawatan kateter urine',
    kind: 'SPO',
    version: 3,
    status: 'draf',
    owner: 'Komite keperawatan',
    author: PERSONA.perawat,
    publishedAt: null,
    reviewDue: null,
  },
  {
    id: 'doc-rm-003-v1',
    code: 'PAN-RM-003',
    title: 'Panduan pelepasan informasi rekam medis dan hak subjek data',
    kind: 'Panduan',
    version: 1,
    status: 'telaah',
    owner: 'Instalasi rekam medis',
    author: PERSONA.petugasRm,
    publishedAt: null,
    reviewDue: null,
  },
  {
    id: 'doc-far-022-v4',
    code: 'SPO-FAR-022',
    title: 'SPO penyimpanan dan pelabelan obat kewaspadaan tinggi',
    kind: 'SPO',
    version: 4,
    status: 'terbit',
    owner: 'Instalasi farmasi',
    author: PERSONA.apoteker,
    publishedAt: '2023-09-20',
    reviewDue: '2026-09-20',
  },
  {
    id: 'doc-ppi-001-v2',
    code: 'KEB-PPI-001',
    title: 'Kebijakan pencegahan dan pengendalian infeksi',
    kind: 'Kebijakan',
    version: 2,
    status: 'terbit',
    owner: 'Komite PPI',
    author: PERSONA.auditorMutu,
    publishedAt: '2025-01-15',
    reviewDue: '2028-01-15',
  },
  {
    id: 'doc-pmkp-001-v2',
    code: 'PED-PMKP-001',
    title: 'Pedoman peningkatan mutu dan keselamatan pasien',
    kind: 'Pedoman',
    version: 2,
    status: 'terbit',
    owner: 'Komite mutu',
    author: PERSONA.auditorMutu,
    publishedAt: '2024-06-03',
    reviewDue: '2027-06-03',
  },
];

export const DOC_APPROVERS = [PERSONA.perawat, PERSONA.direktur, PERSONA.auditorMutu] as const;

/** Unit penerima distribusi dan jumlah staf wajib baca. */
export const DISTRIBUTION_UNITS: ReadonlyArray<{ unit: string; staff: number }> = [
  { unit: 'Ruang Melati', staff: 18 },
  { unit: 'ICU', staff: 22 },
  { unit: 'IGD', staff: 26 },
  { unit: 'Kamar operasi', staff: 15 },
];

/** Tanda terima baca dokumen terbit (per dokumen per unit: sudah baca). */
export const READ_RECEIPTS: Record<string, Record<string, number>> = {
  'doc-far-022-v4': { 'Ruang Melati': 17, ICU: 22, IGD: 21, 'Kamar operasi': 15 },
  'doc-ppi-001-v2': { 'Ruang Melati': 18, ICU: 20, IGD: 24, 'Kamar operasi': 15 },
};

export const ACCREDITATION_CHAPTERS: ReadonlyArray<{
  code: string;
  label: string;
  elements: number;
  withEvidence: number;
}> = [
  { code: 'TKRS', label: 'Tata kelola rumah sakit', elements: 30, withEvidence: 27 },
  { code: 'PMKP', label: 'Peningkatan mutu dan keselamatan pasien', elements: 20, withEvidence: 17 },
  { code: 'PPI', label: 'Pencegahan dan pengendalian infeksi', elements: 25, withEvidence: 23 },
  { code: 'MRMIK', label: 'Manajemen rekam medis dan informasi kesehatan', elements: 51, withEvidence: 44 },
  { code: 'PKPO', label: 'Pelayanan kefarmasian dan penggunaan obat', elements: 28, withEvidence: 25 },
];
