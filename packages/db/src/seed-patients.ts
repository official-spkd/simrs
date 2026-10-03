import type { NewPatientRecord } from './patients';

/** Rekam medis seed selalu ber-ID tetap (idempoten). */
export type SeedPatient = NewPatientRecord & { id: string };

/**
 * P05 · Pasien fiktif untuk seed lokal (docs/09: 200 pasien). Deterministik (PRNG berbenih) sehingga seed
 * idempoten: ID tetap per tenant × nomor urut.
 * Semua identitas jelas fiktif: NIK berawalan 9999 (tidak ada provinsi 99), no. BPJS berawalan 0000,
 * IHS berawalan P9999, no. HP 0812-0000-xxxx. Nama adalah kombinasi nama umum, bukan orang nyata.
 */

// Daftar ditulis sebagai teks berpemisah agar ringkas.
const MALE = words(
  'Agus Ahmad Andi Arif Bambang Budi Dedi Eko Fajar Gilang Hendra Imam Joko Kurnia Lukman Made Nanda Oki Putu ' +
    'Rahmat Rizky Slamet Teguh Wahyu Yusuf Zainal Dimas Bayu Hadi Taufik',
);
const FEMALE = words(
  'Ani Ayu Citra Dewi Dian Endah Fitri Gita Hesti Indah Kartika Lestari Maya Nur Putri Ratna Rina Sari Siti Sri ' +
    'Tari Utami Wulan Yanti Yuni Nia Wati Ika Lina Mega',
);
const FAMILY = words(
  'Santoso Wijaya Saputra Hidayat Kurniawan Pratama Setiawan Nugroho Purnomo Siregar Nasution Harahap Lubis ' +
    'Tanjung Sitompul Simanjuntak Gunawan Halim Susanto Wibowo Firmansyah Ramadhan Maulana Permana Hakim ' +
    'Syahputra Utomo Prasetyo Suryadi Kusuma',
);
const STREETS = words(
  'Kenanga,Melati,Mawar,Anggrek,Cempaka,Flamboyan,Dahlia,Teratai,Kamboja,Bougenville,Seroja,Nusa Indah,Asoka',
  ',',
);
const CITIES = words(
  'Jakarta Timur,Jakarta Selatan,Jakarta Utara,Jakarta Pusat,Bekasi,Depok,Tangerang,Bogor',
  ',',
);

function words(list: string, separator = ' '): string[] {
  return list.split(separator);
}

/** PRNG mulberry32: deret sama untuk benih sama (seed idempoten). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** ID tetap `0199a1t0-0000-7000-8000-nnnnnnnnnnnn` (UUID v7 sah) per tenant (t) dan nomor urut (n). */
export function seedPatientId(tenantIndex: number, n: number): string {
  return `0199a1${tenantIndex}0-0000-7000-8000-${pad(n, 12)}`;
}

/** NIK fiktif berstruktur: 9999 + 2 digit + tanggal lahir (DD, +40 perempuan) MM YY + 4 digit urut. */
export function fakeNik(birthDate: string, sex: 'male' | 'female', seq: number, area = 1): string {
  const [y, m, d] = birthDate.split('-') as [string, string, string];
  const day = sex === 'female' ? Number(d) + 40 : Number(d);
  return `9999${pad(area, 2)}${pad(day, 2)}${m}${y.slice(2)}${pad(seq % 10_000, 4)}`;
}

const fakeBpjs = (seq: number) => `0000${pad(seq * 7919, 9).slice(-9)}`;
const fakeIhs = (seq: number) => `P9999${pad(seq, 7)}`;
const fakePhone = (seq: number) => `628120000${pad(seq % 10_000, 4)}`;

function birthDateFor(rand: () => number): string {
  // Sebaran umur: bayi s.d. lansia; tanggal sampai 28 agar selalu sah.
  const year = 1940 + Math.floor(rand() * 86); // 1940–2025
  return `${year}-${pad(1 + Math.floor(rand() * 12), 2)}-${pad(1 + Math.floor(rand() * 28), 2)}`;
}

/** Pasien acak ke-n (1-based) untuk satu tenant. */
function randomPatient(tenantIndex: number, n: number): SeedPatient {
  const rand = prng(tenantIndex * 100_000 + n);
  const sex = rand() < 0.5 ? 'male' : 'female';
  const first = pick(rand, sex === 'male' ? MALE : FEMALE);
  const name = `${first} ${pick(rand, FAMILY)}`;
  const birthDate = birthDateFor(rand);
  const seq = tenantIndex * 1000 + n;
  const identifiers: NewPatientRecord['identifiers'] = { nik: fakeNik(birthDate, sex, seq, 1 + (n % 20)) };
  if (rand() < 0.7) identifiers.bpjs = fakeBpjs(seq);
  if (rand() < 0.4) identifiers.ihs = fakeIhs(seq);
  return {
    id: seedPatientId(tenantIndex, n),
    name,
    sex,
    birthDate,
    motherName: `${pick(rand, FEMALE)} ${pick(rand, FAMILY)}`,
    address: `Jl. ${pick(rand, STREETS)} No. ${1 + Math.floor(rand() * 120)}, ${pick(rand, CITIES)}`,
    phone: rand() < 0.85 ? fakePhone(seq) : null,
    identifiers,
  };
}

/**
 * Pasangan kemungkinan rekam medis ganda seperti di design/mockups/MPI.dc.html (untuk layar MPI, 7b).
 * Rekam medis B mensimulasikan pendaftaran lama/migrasi data tanpa pemeriksaan NIK.
 */
function plantedDuplicates(tenantIndex: number, start: number): SeedPatient[] {
  const id = (k: number) => seedPatientId(tenantIndex, start + k);
  const nikSiti = fakeNik('1972-03-14', 'female', 4521, 74);
  const bpjsBudi = fakeBpjs(2217);
  return [
    {
      id: id(0),
      name: 'Siti Rahmawati',
      sex: 'female',
      birthDate: '1972-03-14',
      motherName: 'Aminah',
      address: 'Jl. Kenanga No. 12, Jakarta Timur',
      phone: fakePhone(4567),
      identifiers: { nik: nikSiti, bpjs: fakeBpjs(1234), ihs: fakeIhs(213) },
    },
    {
      id: id(1),
      name: 'Siti Rachmawati',
      sex: 'female',
      birthDate: '1972-03-14',
      motherName: 'Aminah',
      address: 'Kenanga No.12, Jaktim',
      phone: fakePhone(4567),
      identifiers: { nik: nikSiti },
    },
    {
      id: id(2),
      name: 'Budi Santoso',
      sex: 'male',
      birthDate: '1965-06-02',
      motherName: 'Sumiati',
      address: 'Jl. Melati No. 4, Jakarta Timur',
      phone: fakePhone(2210),
      identifiers: { nik: fakeNik('1965-06-02', 'male', 937, 75), bpjs: bpjsBudi, ihs: fakeIhs(198) },
    },
    {
      id: id(3),
      name: 'Budi Santosa',
      sex: 'male',
      birthDate: '1965-06-02',
      motherName: 'Sumiyati',
      address: 'Jl. Melati No. 4, Jakarta Timur',
      identifiers: { bpjs: bpjsBudi },
    },
    {
      id: id(4),
      name: 'By. Ny. Ratna',
      sex: 'male',
      birthDate: '2026-09-21',
      motherName: 'Ratna Sari',
      address: 'Jl. Anggrek No. 7, Jakarta Timur',
      phone: fakePhone(3301),
      identifiers: { ihs: fakeIhs(221) },
    },
    {
      id: id(5),
      name: 'Arka Pratama',
      sex: 'male',
      birthDate: '2026-09-21',
      motherName: 'Ratna Sari',
      address: 'Jl. Anggrek No. 7, Jakarta Timur',
      phone: fakePhone(3301),
      identifiers: { bpjs: fakeBpjs(3390) },
    },
    {
      id: id(6),
      name: 'Muhammad Rizki',
      sex: 'male',
      birthDate: '1998-11-09',
      motherName: 'Halimah',
      address: 'Jl. Cempaka No. 21, Jakarta Utara',
      phone: fakePhone(7781),
      identifiers: { nik: fakeNik('1998-11-09', 'male', 1180, 72) },
    },
    {
      id: id(7),
      name: 'M. Rizky',
      sex: 'male',
      birthDate: '1998-11-09',
      address: 'Jl. Cemara No. 3, Bekasi',
      phone: fakePhone(1202),
      identifiers: { nik: fakeNik('1998-11-09', 'male', 1810, 72) },
    },
    {
      id: id(8),
      name: 'Darmawan',
      sex: 'male',
      birthDate: '1962-08-17',
      address: 'Jl. Flamboyan No. 9, Jakarta Pusat',
      identifiers: { nik: fakeNik('1962-08-17', 'male', 6612, 71) },
    },
    {
      id: id(9),
      name: 'Tn. X (tanpa identitas)',
      sex: 'male',
      birthDate: '1963-01-01',
      birthDateEstimated: true,
      unidentified: true,
    },
  ];
}

/**
 * Daftar pasien seed per tenant, total `count` rekam medis. Bila `withDuplicates`, 10 di antaranya adalah
 * pasangan kemungkinan duplikat (layar MPI).
 */
export function seedPatients(tenantIndex: number, count: number, withDuplicates: boolean): SeedPatient[] {
  const planted = withDuplicates ? plantedDuplicates(tenantIndex, count + 1) : [];
  const randomCount = count - planted.length;
  const random = Array.from({ length: randomCount }, (_, i) => randomPatient(tenantIndex, i + 1));
  return [...random, ...planted];
}
