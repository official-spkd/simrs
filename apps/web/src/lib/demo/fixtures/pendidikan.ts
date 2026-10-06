import type { LogbookEntry, SupervisionLevel } from '../../pendidikan';
import { PATIENT_ID } from './ids';
import { patientById } from './pasien';
import { PERSONA, STAF } from './staf';

/**
 * B10 · Data dummy pendidikan klinik (ADR-0023): residen = persona dokter residen (wajib co-sign), koas dan
 * mahasiswa keperawatan fiktif. Logbook hanya nomor RM.
 */

const rm = (id: string) => patientById(id)?.rm ?? '—';

export interface Trainee {
  id: string;
  name: string;
  program: string;
  supervisor: string;
  rotation: string;
  period: string;
  level: SupervisionLevel;
  competency: string;
  pendingCosign: number;
}

export const TRAINEES: readonly Trainee[] = [
  {
    id: 'pd-1',
    name: PERSONA.dokterResiden,
    program: 'PPDS Ilmu Penyakit Dalam · semester 5',
    supervisor: STAF.dpjpPenyakitDalam,
    rotation: 'Stase rawat inap penyakit dalam',
    period: '1 Sep – 30 Nov 2026',
    level: 2,
    competency: 'Pemasangan kateter vena sentral',
    pendingCosign: 3,
  },
  {
    id: 'pd-2',
    name: 'dr. Bima Aryasatya',
    program: 'PPDS Ilmu Bedah · semester 3',
    supervisor: STAF.dpjpBedah,
    rotation: 'Stase bedah digestif',
    period: '1 Okt – 31 Des 2026',
    level: 3,
    competency: 'Apendektomi terbuka',
    pendingCosign: 1,
  },
  {
    id: 'pd-3',
    name: 'Nadya Putri Kirana (koas)',
    program: 'Pendidikan profesi dokter · kepaniteraan klinik',
    supervisor: STAF.dpjpPenyakitDalam,
    rotation: 'Kepaniteraan penyakit dalam',
    period: '14 Sep – 8 Nov 2026',
    level: 1,
    competency: 'Pemeriksaan fisik terarah',
    pendingCosign: 0,
  },
  {
    id: 'pd-4',
    name: 'Fajar Ramadhan (mahasiswa Ners)',
    program: 'Profesi Ners · stase keperawatan medikal bedah',
    supervisor: PERSONA.perawat,
    rotation: 'Ruang Melati',
    period: '28 Sep – 24 Okt 2026',
    level: 2,
    competency: 'Pemasangan infus perifer',
    pendingCosign: 2,
  },
];

const e = (
  id: string,
  traineeId: string,
  competency: string,
  date: string,
  patient: string,
  role: LogbookEntry['role'],
  status: LogbookEntry['status'],
): LogbookEntry => ({ id, traineeId, competency, date, rm: rm(patient), role, status });

const CVC = 'Pemasangan kateter vena sentral';

export const LOGBOOK: readonly LogbookEntry[] = [
  e('lb-01', 'pd-1', CVC, '2026-09-08', PATIENT_ID.sutan, 'asistensi', 'terverifikasi'),
  e('lb-02', 'pd-1', CVC, '2026-09-15', PATIENT_ID.gilang, 'mandiri dibimbing', 'terverifikasi'),
  e('lb-03', 'pd-1', CVC, '2026-09-22', PATIENT_ID.robert, 'mandiri dibimbing', 'terverifikasi'),
  e('lb-04', 'pd-1', CVC, '2026-09-29', PATIENT_ID.yusuf, 'mandiri dibimbing', 'terverifikasi'),
  e('lb-05', 'pd-1', CVC, '2026-10-03', PATIENT_ID.sutan, 'mandiri dibimbing', 'menunggu'),
  e('lb-06', 'pd-1', CVC, '2026-10-04', PATIENT_ID.fajar, 'observasi', 'menunggu'),
  e(
    'lb-07',
    'pd-4',
    'Pemasangan infus perifer',
    '2026-10-02',
    PATIENT_ID.endang,
    'mandiri dibimbing',
    'menunggu',
  ),
  e('lb-08', 'pd-2', 'Apendektomi terbuka', '2026-10-02', PATIENT_ID.fauzi, 'asistensi', 'menunggu'),
];
