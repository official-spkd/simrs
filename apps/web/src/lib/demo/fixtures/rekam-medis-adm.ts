import type { RecordFile, RecordLoan, RetentionBatch, RoiKind } from '../../rekam-medis-adm';
import { PATIENT_ID } from './ids';
import { patientById } from './pasien';
import { PERSONA } from './staf';

/**
 * B09 · Data dummy rekam medis administratif (ADR-0023). Pasien dari `PASIEN` (berkas fisik era sebelum RME),
 * pemohon dan unit generik fiktif, hari demo Sen, 5 Okt 2026.
 */

function file(
  id: string,
  patientId: string,
  rack: string,
  lastVisit: string,
  extra: Partial<Pick<RecordFile, 'legalHold' | 'confidential'>> = {},
): RecordFile {
  const p = patientById(patientId);
  if (!p) throw new Error(`pasien fixture tidak ada: ${patientId}`);
  return {
    id,
    rm: p.rm,
    patientName: p.nama,
    rack,
    lastVisit,
    legalHold: extra.legalHold ?? null,
    confidential: extra.confidential ?? false,
  };
}

export const RECORD_FILES: readonly RecordFile[] = [
  file('berkas-01', PATIENT_ID.endang, 'R-04 · baris 3', '2023-11-20'),
  file('berkas-02', PATIENT_ID.sutan, 'R-07 · baris 1', '2022-04-02'),
  file('berkas-03', PATIENT_ID.hendro, 'R-02 · baris 5', '2024-08-14'),
  file('berkas-04', PATIENT_ID.robert, 'R-09 · baris 2', '2021-06-30', {
    legalHold: 'perkara PN No. 412/2026',
  }),
  file('berkas-05', PATIENT_ID.sumarni, 'R-05 · baris 4', '2023-02-11'),
  file('berkas-06', PATIENT_ID.lukman, 'R-03 · baris 2', '2024-12-09', { confidential: true }),
  file('berkas-07', PATIENT_ID.darmawan, 'R-06 · baris 6', '2022-09-27'),
];

export const RECORD_LOANS: readonly RecordLoan[] = [
  {
    id: 'pinjam-01',
    fileId: 'berkas-01',
    borrower: 'dr. Sinta Maharani, Sp.PD-KGH',
    unit: 'Poli Penyakit Dalam',
    purpose: 'Riwayat dialisis sebelum era RME untuk kontrol',
    outDate: '2026-10-05',
    dueDate: '2026-10-08',
    returnedAt: null,
  },
  {
    id: 'pinjam-02',
    fileId: 'berkas-02',
    borrower: 'Arif Nugroho, A.Md.RMIK',
    unit: 'Koding & klaim',
    purpose: 'Verifikasi riwayat untuk banding klaim',
    outDate: '2026-09-29',
    dueDate: '2026-10-02',
    returnedAt: null,
  },
  {
    id: 'pinjam-03',
    fileId: 'berkas-05',
    borrower: 'Komite medik',
    unit: 'Komite medik',
    purpose: 'Audit klinis kasus stroke 2023',
    outDate: '2026-10-01',
    dueDate: '2026-10-04',
    returnedAt: null,
  },
  {
    id: 'pinjam-04',
    fileId: 'berkas-07',
    borrower: 'dr. Kartika Sari, Sp.P',
    unit: 'Poli Paru',
    purpose: 'Riwayat TB paru 2022',
    outDate: '2026-09-30',
    dueDate: '2026-10-03',
    returnedAt: '2026-10-02T14:20:00+07:00',
  },
];

/** Unit peminjam yang bisa dipilih di formulir. */
export const LOAN_UNITS = [
  'Poli Penyakit Dalam',
  'Poli Jantung',
  'Poli Paru',
  'Komite medik',
  'Koding & klaim',
  'Satuan pemeriksaan internal',
] as const;

export interface RoiRequest {
  id: string;
  number: string;
  kind: RoiKind;
  requester: string;
  requesterKind: string;
  patientId: string;
  basis: string;
  scope: readonly string[];
  /** ISO, diterima petugas RM. */
  receivedAt: string;
  receiver: string;
  /** Tahap awal fixture (0 diajukan, 1 terverifikasi). */
  stage: 0 | 1;
  verifiedAt?: string;
  /** Hak perbaikan: data lama → usulan baru (diterapkan sebagai versi baru, data lama tetap tersimpan). */
  correction?: ReadonlyArray<{ field: string; from: string; to: string }>;
}

export const ROI_RECEIVER = PERSONA.petugasRm;

export const ROI_APPROVERS = [
  { name: PERSONA.petugasRm, role: 'Petugas rekam medis (penerima)' },
  { name: PERSONA.petugasPrivasi, role: 'Petugas privasi' },
  { name: 'Ns. Hana Puspita, S.KM', role: 'Kepala instalasi rekam medis' },
] as const;

const wulan = patientById(PATIENT_ID.wulan) ?? { alamat: '', telepon: '' };

export const ROI_REQUESTS: readonly RoiRequest[] = [
  {
    id: 'roi-07',
    number: 'ROI-2610-007',
    kind: 'pihak-ketiga',
    requester: 'Asuransi swasta mitra AS-03',
    requesterKind: 'Asuransi',
    patientId: PATIENT_ID.ratna,
    basis: 'Persetujuan tertulis pasien (formulir RM-ROI-01, ditandatangani Jum, 2 Okt 2026)',
    scope: ['Resume medis', 'Laporan operasi', 'Hasil laboratorium'],
    receivedAt: '2026-10-03T14:00:00+07:00',
    receiver: ROI_RECEIVER,
    stage: 0,
  },
  {
    id: 'roi-08',
    number: 'ROI-2610-008',
    kind: 'salinan',
    requester: 'Pasien sendiri (datang ke loket RM)',
    requesterKind: 'Subjek data',
    patientId: PATIENT_ID.suryo,
    basis: 'Hak akses subjek data (UU No. 27/2022 tentang Pelindungan Data Pribadi)',
    scope: ['Resume rawat jalan 2026', 'Hasil laboratorium 2026'],
    receivedAt: '2026-10-05T08:30:00+07:00',
    receiver: ROI_RECEIVER,
    stage: 0,
  },
  {
    id: 'roi-09',
    number: 'ROI-2610-009',
    kind: 'koreksi',
    requester: 'Pasien sendiri (melalui aplikasi pasien)',
    requesterKind: 'Subjek data',
    patientId: PATIENT_ID.wulan,
    basis: 'Hak perbaikan data pribadi yang tidak akurat (UU PDP)',
    scope: ['Alamat domisili', 'Nomor telepon'],
    receivedAt: '2026-10-02T09:15:00+07:00',
    receiver: ROI_RECEIVER,
    stage: 1,
    verifiedAt: '2026-10-02T11:05:00+07:00',
    correction: [
      { field: 'Alamat domisili', from: wulan.alamat, to: 'Jl. Kenanga 14, Tangerang Selatan' },
      { field: 'Nomor telepon', from: wulan.telepon, to: '0812-0000-4590' },
    ],
  },
  {
    id: 'roi-05',
    number: 'ROI-2610-005',
    kind: 'pihak-ketiga',
    requester: 'Pengadilan negeri (perkara pidana)',
    requesterKind: 'Penegak hukum',
    patientId: PATIENT_ID.robert,
    basis: 'Penetapan hakim (salinan resmi diperlihatkan, asli dicek)',
    scope: ['Visum et repertum', 'Resume IGD'],
    receivedAt: '2026-10-03T08:00:00+07:00',
    receiver: ROI_RECEIVER,
    stage: 0,
  },
];

export const RETENTION_BATCHES: readonly RetentionBatch[] = [
  {
    id: 'ret-r12',
    label: 'Rak R-12 · rawat jalan 2014–2015',
    setting: 'rawat-jalan',
    lastVisit: '2015-12-30',
    files: 1240,
    permanentSheets: 188,
    legalHoldFiles: 2,
  },
  {
    id: 'ret-r13',
    label: 'Rak R-13 · rawat jalan 2016',
    setting: 'rawat-jalan',
    lastVisit: '2016-12-29',
    files: 980,
    permanentSheets: 124,
    legalHoldFiles: 1,
  },
  {
    id: 'ret-r14',
    label: 'Rak R-14 · rawat jalan 2021',
    setting: 'rawat-jalan',
    lastVisit: '2021-12-30',
    files: 1105,
    permanentSheets: 141,
    legalHoldFiles: 0,
  },
];

/** Anggota komite RM (pengusul) dan direktur (penyetuju) untuk jejak pemusnahan. */
export const DESTRUCTION_ACTORS = {
  committee: 'Ns. Hana Puspita, S.KM (ketua komite RM)',
  director: PERSONA.direktur,
  witness: 'Satuan pemeriksaan internal',
} as const;
