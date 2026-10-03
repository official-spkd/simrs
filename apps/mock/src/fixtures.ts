import { createHash } from 'node:crypto';

/**
 * Data fiktif deterministik dari NIK. NIK uji memakai awalan 9999 agar jelas bukan data nyata.
 * Tidak ada data pasien nyata di mock.
 */
const NAMES = ['Pasien Fiktif Satu', 'Pasien Fiktif Dua', 'Pasien Fiktif Tiga', 'Pasien Fiktif Empat'];

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

export function isNik(value: string): boolean {
  return /^\d{16}$/.test(value);
}

export function fakePerson(nik: string) {
  const d = digest(nik);
  const year = 1950 + ((d[0] ?? 0) % 60);
  const month = 1 + ((d[1] ?? 0) % 12);
  const day = 1 + ((d[2] ?? 0) % 28);
  return {
    nik,
    nama: NAMES[(d[3] ?? 0) % NAMES.length] ?? 'Pasien Fiktif',
    jenisKelamin: (d[4] ?? 0) % 2 === 0 ? 'L' : 'P',
    tanggalLahir: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    kabupaten: 'KAB. FIKTIF',
  };
}

/** No. kartu BPJS fiktif 13 digit berawalan 0000. */
export function fakeBpjsCard(nik: string): string {
  return `0000${BigInt(`0x${digest(`bpjs:${nik}`).toString('hex').slice(0, 12)}`)
    .toString()
    .slice(0, 9)
    .padStart(9, '0')}`;
}

/** IHS number fiktif (format `P` + 11 digit). */
export function fakeIhs(nik: string): string {
  return `P${BigInt(`0x${digest(`ihs:${nik}`).toString('hex').slice(0, 12)}`)
    .toString()
    .slice(0, 11)
    .padStart(11, '0')}`;
}
