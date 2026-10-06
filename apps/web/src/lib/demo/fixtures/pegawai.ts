import type { License, Roster, Shift } from '../../sdm';
import { DOKTER, PERSONA, STAF, STAF_LAIN } from './staf';

/**
 * B03 · Pegawai fiktif mode presentasi (ADR-0023). Nama memakai staf yang sudah tampil di layar lain (dokter,
 * persona akun presentasi, perawat jaga) agar konsisten; NIP dan NIK jelas fiktif (awalan 9999). Dipakai juga
 * kredensial (B04), penggajian (B05), dan pendidikan klinik (B10).
 */

export type EmployeeGroup =
  'medis' | 'keperawatan' | 'kebidanan' | 'kefarmasian' | 'penunjang' | 'administrasi';

export interface Employee {
  id: string;
  nip: string;
  name: string;
  position: string;
  group: EmployeeGroup;
  unit: string;
  /** NIK fiktif utuh (awalan 9999); layar menampilkan versi tersamar kecuali dibuka beralasan. */
  nik: string;
  joinDate: string;
  licenses: readonly License[];
}

export const GROUP_LABEL: Record<EmployeeGroup, string> = {
  medis: 'Tenaga medis',
  keperawatan: 'Keperawatan',
  kebidanan: 'Kebidanan',
  kefarmasian: 'Kefarmasian',
  penunjang: 'Penunjang medis',
  administrasi: 'Administrasi',
};

const doctor = (name: string) => {
  const d = DOKTER.find((x) => x.nama === name);
  if (!d) throw new Error(`dokter fixture tidak ada: ${name}`);
  return d.nama;
};

const [nYudi = '', nRosa = '', nFikri = '', nGalih = ''] = STAF_LAIN.perawat;

let seq = 0;
function emp(
  name: string,
  position: string,
  group: EmployeeGroup,
  unit: string,
  joinDate: string,
  licenses: License[],
): Employee {
  seq += 1;
  const n = String(seq).padStart(4, '0');
  return {
    id: `peg-${n}`,
    nip: `9999-${joinDate.slice(0, 4)}-${n}`,
    name,
    position,
    group,
    unit,
    nik: `9999${joinDate.slice(2, 4)}${joinDate.slice(5, 7)}0000${n}`,
    joinDate,
    licenses,
  };
}

const str = (no: string): License => ({ kind: 'STR', number: `STR ${no}`, expiry: null });
const sip = (no: string, expiry: string): License => ({ kind: 'SIP', number: `SIP ${no}`, expiry });

export const EMPLOYEES: readonly Employee[] = [
  emp(
    STAF.dpjpPenyakitDalam,
    'Dokter spesialis penyakit dalam',
    'medis',
    'Poli Penyakit Dalam',
    '2016-03-01',
    [str('9999-01-1601'), sip('9999/PD/0112', '2028-03-14')],
  ),
  emp(
    doctor('dr. Rahmat Hidayat, Sp.PD'),
    'Dokter spesialis penyakit dalam',
    'medis',
    'Poli Penyakit Dalam',
    '2019-07-01',
    [str('9999-01-1902'), sip('9999/PD/0187', '2026-11-20')],
  ),
  emp(STAF.dpjpJantung, 'Dokter spesialis jantung', 'medis', 'Poli Jantung', '2018-01-02', [
    str('9999-01-1803'),
    sip('9999/JT/0144', '2029-01-31'),
  ]),
  emp(STAF.dpjpBedah, 'Dokter spesialis bedah', 'medis', 'Instalasi bedah', '2017-09-01', [
    str('9999-01-1704'),
    sip('9999/BD/0131', '2027-06-30'),
  ]),
  emp(STAF.dokterJagaIgd, 'Dokter umum jaga IGD', 'medis', 'IGD', '2022-02-01', [
    str('9999-01-2205'),
    sip('9999/UM/0410', '2026-09-30'),
  ]),
  emp(
    doctor('dr. Ferry Setiawan, Sp.An'),
    'Dokter spesialis anestesi',
    'medis',
    'Instalasi bedah',
    '2020-05-04',
    [str('9999-01-2006'), sip('9999/AN/0099', '2026-12-01')],
  ),
  emp(PERSONA.perawat, 'Perawat penanggung jawab', 'keperawatan', 'Ruang Melati', '2015-08-03', [
    str('9999-02-1507'),
    sip('9999/PR/2208', '2027-08-10'),
  ]),
  emp(nYudi, 'Perawat pelaksana', 'keperawatan', 'Ruang Melati', '2019-01-07', [
    str('9999-02-1908'),
    sip('9999/PR/2311', '2026-10-25'),
  ]),
  emp(nRosa, 'Perawat pelaksana', 'keperawatan', 'Ruang Melati', '2020-03-02', [
    str('9999-02-2009'),
    sip('9999/PR/2320', '2028-02-01'),
  ]),
  emp(nFikri, 'Perawat pelaksana', 'keperawatan', 'Ruang Melati', '2021-06-01', [
    str('9999-02-2110'),
    sip('9999/PR/2402', '2027-12-12'),
  ]),
  emp('Ns. Intan Permata, S.Kep', 'Perawat pelaksana', 'keperawatan', 'Ruang Melati', '2022-01-03', [
    str('9999-02-2211'),
    sip('9999/PR/2415', '2027-03-21'),
  ]),
  emp('Ns. Rudi Hartanto, S.Kep', 'Perawat pelaksana', 'keperawatan', 'Ruang Melati', '2023-04-03', [
    str('9999-02-2312'),
    sip('9999/PR/2511', '2028-04-03'),
  ]),
  emp('Ns. Sekar Ayu, S.Kep', 'Perawat pelaksana', 'keperawatan', 'Ruang Melati', '2024-02-01', [
    str('9999-02-2413'),
    sip('9999/PR/2603', '2029-02-01'),
  ]),
  emp(
    'Ns. Wahyu Nugraha, S.Kep',
    'Perawat cadangan (float)',
    'keperawatan',
    'Pool keperawatan',
    '2021-09-01',
    [str('9999-02-2114'), sip('9999/PR/2420', '2027-09-01')],
  ),
  emp(nGalih, 'Perawat pelaksana', 'keperawatan', 'IGD', '2020-11-02', [
    str('9999-02-2015'),
    sip('9999/PR/2330', '2027-04-04'),
  ]),
  emp(PERSONA.bidan, 'Bidan pelaksana', 'kebidanan', 'Ruang bersalin', '2019-10-01', [
    str('9999-03-1916'),
    sip('9999/BD/0311', '2027-09-09'),
  ]),
  emp(PERSONA.apoteker, 'Apoteker penanggung jawab', 'kefarmasian', 'Instalasi farmasi', '2017-04-03', [
    str('9999-04-1717'),
    sip('9999/AP/0051', '2026-11-30'),
  ]),
  emp(PERSONA.analisLab, 'Ahli teknologi laboratorium medik', 'penunjang', 'Laboratorium', '2018-06-04', [
    str('9999-05-1818'),
    sip('9999/LB/0207', '2028-06-04'),
  ]),
  emp(PERSONA.petugasRm, 'Perekam medis', 'administrasi', 'Instalasi rekam medis', '2020-01-06', [
    str('9999-06-2019'),
  ]),
  emp(PERSONA.kasir, 'Kasir', 'administrasi', 'Keuangan', '2021-03-01', []),
];

export function employeeByName(name: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.name === name);
}

/** Unit yang jadwal dinasnya bisa diatur di layar (minimum per dinas dari kebijakan keperawatan). */
export const ROSTER_UNIT = {
  unit: 'Ruang Melati',
  weekLabel: 'Sen, 12 Okt – Min, 18 Okt 2026',
  weekStart: '2026-10-12',
  minimum: { P: 2, S: 2, M: 1 } satisfies Record<Shift, number>,
  dayLabels: ['Sen 12', 'Sel 13', 'Rab 14', 'Kam 15', 'Jum 16', 'Sab 17', 'Min 18'],
} as const;

/** Perawat Ruang Melati + perawat cadangan (boleh ditarik mengisi kekosongan). */
export const ROSTER_STAFF = EMPLOYEES.filter(
  (e) => e.group === 'keperawatan' && (e.unit === 'Ruang Melati' || e.unit === 'Pool keperawatan'),
);

/** Draf jadwal minggu depan per hari: [Pagi, Siang, Malam] dalam indeks perawat Ruang Melati (urutan `ROSTER_STAFF`). */
const DRAFT: ReadonlyArray<readonly [readonly number[], readonly number[], readonly number[]]> = [
  [[0, 1], [2, 3], [4]],
  [[0, 5], [1, 2], [6]],
  // Rab siang kurang satu (perawat 1 cuti mendadak).
  [[3, 5], [0], [2]],
  [[4, 6], [3, 5], [0]],
  // Jum pagi memuat perawat yang dinas malam Kamis: jeda istirahat dilanggar.
  [[2, 0], [6, 1], [3]],
  // Sab malam kosong.
  [[1, 6], [4, 5], []],
  [[4, 5], [2, 6], [3]],
];

/**
 * Draf jadwal minggu depan Ruang Melati: rotasi 7 perawat (P2/S2/M1, lima dinas per orang) dengan tiga cacat
 * realistis untuk ditangani di layar sebelum terbit.
 */
export function draftRoster(): Roster {
  const ward = ROSTER_STAFF.filter((e) => e.unit === 'Ruang Melati').map((e) => e.id);
  const ids = (xs: readonly number[]) => xs.map((i) => ward[i] ?? '').filter(Boolean);
  const roster: Roster = {};
  DRAFT.forEach(([p, s, m], d) => {
    roster[d] = { P: ids(p), S: ids(s), M: ids(m) };
  });
  return roster;
}
