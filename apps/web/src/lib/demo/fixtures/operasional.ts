import type { BackupLocation, BackupRun } from '../../operasional-backup';
import type { PaperForm } from '../../operasional-downtime';
import { PATIENT_ID } from './ids';
import { PASIEN } from './pasien';
import { PERSONA, STAF } from './staf';

/**
 * FE1 · Fixture operasional fase 10 (ADR-0023): latihan downtime (P13), cadangan & pemulihan (ADR-0071), dan
 * kesiapan go-live. Nama pasien dari fixture bersama (bukan pasien skenario), staf fiktif.
 */

const nama = (id: string) => PASIEN.find((p) => p.id === id)?.nama ?? '–';

export const DOWNTIME_PAPER_FORMS: readonly PaperForm[] = [
  {
    id: 'kertas-1',
    form: 'Pendaftaran darurat',
    patient: nama(PATIENT_ID.darmawan),
    offset: 6,
    by: PERSONA.petugasPendaftaran,
  },
  {
    id: 'kertas-2',
    form: 'Catatan pemberian obat (eMAR kertas)',
    patient: nama(PATIENT_ID.endang),
    offset: 12,
    by: PERSONA.perawat,
  },
  { id: 'kertas-3', form: 'Tanda vital', patient: nama(PATIENT_ID.yusuf), offset: 19, by: PERSONA.perawat },
  { id: 'kertas-4', form: 'CPPT kertas', patient: nama(PATIENT_ID.sutan), offset: 27, by: STAF.dpjpJantung },
];

/** Isi paket cetak darurat per ruang (disiapkan job P11 tiap 4 jam di server edge). */
export const EMERGENCY_PACK = {
  ward: 'Bangsal Melati',
  patients: 12,
  forms: [
    'Daftar pasien per ruang + alergi',
    'Obat aktif + jadwal eMAR 8 jam',
    'CPPT terakhir',
    'Formulir pendaftaran darurat',
    'Surat jaminan sementara BPJS',
  ],
  sample: `${nama(PATIENT_ID.endang)} · alergi Amoksisilin · seftriakson 1 g/12 jam …`,
} as const;

// ---------------------------------------------------------------------------------------------------------
// Cadangan & pemulihan (ADR-0071)
// ---------------------------------------------------------------------------------------------------------

export const BACKUP_LOCATIONS: readonly BackupLocation[] = [
  {
    id: 'edge',
    label: 'Lokal server edge',
    where: 'Disk server edge di RS',
    schedule: 'Per jam menit 05 + harian 01.30',
    lastOkAt: '2026-10-05T10:05:00+07:00',
    sizeLabel: '2,41 GB',
    kept: { jam: 48, harian: 35, bulanan: 12, manual: 3 },
  },
  {
    id: 'cloud',
    label: 'Cloud utama',
    where: 'Bucket cadangan utama (terenkripsi sebelum keluar server)',
    schedule: 'Per jam menit 05 + harian 01.30',
    lastOkAt: '2026-10-05T10:05:00+07:00',
    sizeLabel: '2,41 GB',
    kept: { jam: 48, harian: 35, bulanan: 12, manual: 3 },
  },
  {
    id: 'offsite',
    label: 'Offsite terenkripsi',
    where: 'Penyedia/region lain, object lock',
    schedule: 'Cermin tiap jam + uji restore bulanan',
    lastOkAt: '2026-10-05T10:05:00+07:00',
    sizeLabel: '2,38 GB',
    kept: { jam: 48, harian: 35, bulanan: 9, manual: 3 },
  },
];

export const BACKUP_RUNS: readonly BackupRun[] = [
  {
    id: 'bk-1005-1005',
    at: '2026-10-05T10:05:00+07:00',
    kind: 'jam',
    status: 'success',
    durationSec: 212,
    note: '2,41 GB · manifest 214 tabel',
  },
  {
    id: 'bk-1005-0905',
    at: '2026-10-05T09:05:00+07:00',
    kind: 'jam',
    status: 'success',
    durationSec: 205,
    note: '2,41 GB',
  },
  {
    id: 'bk-1005-0805',
    at: '2026-10-05T08:05:00+07:00',
    kind: 'jam',
    status: 'partial',
    durationSec: 431,
    note: 'Offsite tidak menjawab; lokal + cloud tersimpan, offsite tersusul 09.05',
  },
  {
    id: 'bk-1005-0130',
    at: '2026-10-05T01:30:00+07:00',
    kind: 'harian',
    status: 'success',
    durationSec: 248,
    note: 'Termasuk berkas dokumen (tar terenkripsi)',
  },
];

export const LAST_RESTORE_TEST = {
  at: '2026-10-04T03:00:00+07:00',
  rtoMinutes: 38,
  source: 'cloud utama',
} as const;

/** Manifest jumlah baris (hasil uji restore dicocokkan dengan ini). */
export const MANIFEST_ROWS: ReadonlyArray<readonly [string, number]> = [
  ['Pasien (MPI)', 48_212],
  ['Kunjungan', 312_904],
  ['Jejak audit', 1_284_551],
  ['Dokumen', 96_118],
  ['Tagihan', 201_377],
];
