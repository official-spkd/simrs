import { bpjsAddDays, type VclaimPeserta, type VclaimRujukan } from '@simrs/shared';
import { diagnosaNama, MOCK_FKTP, MOCK_POLI, MOCK_RS_PERUJUK } from './master';

/**
 * Rujukan fiktif tanpa keadaan: nomor 19 karakter `<PPK perujuk 8><9 digit akhir kartu><urut 2>` sehingga
 * pemilik dan isinya bisa diturunkan dari nomornya sendiri.
 * - urut `99` → kedaluwarsa (kunjungan 120 hari lalu);
 * - urut lain → aktif; poli bergilir INT, JAN, SAR, PAR (01 = INT, 02 = JAN, …), kunjungan beberapa hari lalu.
 * Daftar per kartu: FKTP = urut 01 (aktif) + 99 (kedaluwarsa); RS = urut 01.
 */

export type JenisRujukan = 'fktp' | 'rs';

export interface ParsedRujukan {
  noRujukan: string;
  ppk: string;
  jenis: JenisRujukan;
  noKartu: string;
  urut: string;
}

const DIAG_PER_POLI: Readonly<Record<string, string>> = {
  INT: 'I10',
  JAN: 'I20.0',
  SAR: 'I63.9',
  PAR: 'J18.9',
};
const KELUHAN_PER_POLI: Readonly<Record<string, string>> = {
  INT: 'Kontrol tekanan darah',
  JAN: 'Nyeri dada saat aktivitas',
  SAR: 'Kelemahan anggota gerak',
  PAR: 'Batuk dan sesak',
};

export const URUT_KEDALUWARSA = '99';

export function noRujukanFor(ppk: string, noKartu: string, urut: string): string {
  return `${ppk}${noKartu.slice(-9)}${urut}`;
}

export function parseNoRujukan(noRujukan: string): ParsedRujukan | null {
  const m = /^([0-9A-Z]{8})(\d{9})(\d{2})$/.exec(noRujukan);
  if (!m) return null;
  const [, ppk = '', digits = '', urut = ''] = m;
  const jenis: JenisRujukan | null = MOCK_FKTP.some((f) => f.kode === ppk)
    ? 'fktp'
    : ppk === MOCK_RS_PERUJUK.kode
      ? 'rs'
      : null;
  if (!jenis || urut === '00') return null;
  return { noRujukan, ppk, jenis, noKartu: `0000${digits}`, urut };
}

/** Nomor rujukan milik peserta (untuk daftar per kartu). */
export function rujukanNumbersFor(peserta: VclaimPeserta, jenis: JenisRujukan): string[] {
  if (jenis === 'rs') return [noRujukanFor(MOCK_RS_PERUJUK.kode, peserta.noKartu, '01')];
  const fktp = peserta.provUmum.kdProvider;
  return [noRujukanFor(fktp, peserta.noKartu, '01'), noRujukanFor(fktp, peserta.noKartu, URUT_KEDALUWARSA)];
}

/** Isi rujukan dari nomornya. `today` = tanggal WIB hari ini. */
export function buildRujukan(parsed: ParsedRujukan, peserta: VclaimPeserta, today: string): VclaimRujukan {
  const expired = parsed.urut === URUT_KEDALUWARSA;
  const n = Number(parsed.urut);
  const poli = expired ? MOCK_POLI[0] : MOCK_POLI[(n - 1) % MOCK_POLI.length];
  const kodePoli = poli?.kode ?? 'INT';
  const diag = expired ? 'K30' : (DIAG_PER_POLI[kodePoli] ?? 'I10');
  const perujuk =
    parsed.jenis === 'rs' ? MOCK_RS_PERUJUK : (MOCK_FKTP.find((f) => f.kode === parsed.ppk) ?? MOCK_FKTP[0]);
  return {
    noKunjungan: parsed.noRujukan,
    tglKunjungan: bpjsAddDays(today, expired ? -120 : -(5 + ((n * 7) % 60))),
    provPerujuk: { kode: perujuk.kode, nama: perujuk.nama },
    peserta,
    poliRujukan: { kode: kodePoli, nama: poli?.nama ?? 'PENYAKIT DALAM' },
    pelayanan: { kode: '2', nama: 'Rawat Jalan' },
    diagnosa: { kode: diag, nama: diagnosaNama(diag) },
    keluhan: expired ? 'Nyeri ulu hati' : (KELUHAN_PER_POLI[kodePoli] ?? 'Kontrol'),
  };
}
