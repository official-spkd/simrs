import { createHash } from 'node:crypto';
import { bpjsAddDays, nikBirthInfo, VCLAIM_PESERTA_AKTIF, type VclaimPeserta } from '@simrs/shared';
import { fakeBpjsCard, fakePerson } from '../../fixtures';
import { MOCK_FKTP } from './master';
import type { BpjsState } from './state';

/**
 * Peserta JKN fiktif yang deterministik. Aturan yang bisa diandalkan tes dan demo:
 * - no. kartu di luar rentang fiktif (awalan `0000`) atau NIK tanpa awalan `9999` → tidak ditemukan;
 * - kartu atau NIK berakhiran `9999` → tidak ditemukan (selaras Dukcapil);
 * - kartu atau NIK berakhiran `0000` → status TIDAK AKTIF;
 * - kartu berakhiran `1111` → wajib rekam sidik jari sebelum SEP rawat jalan (`POST /_panel/api/bpjs/fingerprint`).
 * Tanggal lahir dan jenis kelamin mengikuti struktur NIK bila sah; kartu ↔ NIK diingat sampai reset.
 */

const JENIS_PESERTA = [
  { kode: '1', keterangan: 'PBI (APBN)' },
  { kode: '2', keterangan: 'PEKERJA PENERIMA UPAH' },
  { kode: '3', keterangan: 'PEKERJA BUKAN PENERIMA UPAH' },
] as const;
const KELAS = { '1': 'KELAS I', '2': 'KELAS II', '3': 'KELAS III' } as const;

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isFictionalKartu(noKartu: string): boolean {
  return /^0000\d{9}$/.test(noKartu);
}

export function needsFingerprint(noKartu: string): boolean {
  return noKartu.endsWith('1111');
}

/** NIK fiktif berstruktur (9999 + wilayah + DDMMYY + 4 digit akhir kartu) untuk kartu yang belum dikenal. */
function fakeNikFromKartu(noKartu: string): string {
  const d = digest(`nik:${noKartu}`);
  const female = (d[0] ?? 0) % 2 === 1;
  const day = 1 + ((d[1] ?? 0) % 28);
  const month = 1 + ((d[2] ?? 0) % 12);
  const yy = (50 + ((d[3] ?? 0) % 60)) % 100;
  return `999901${pad(female ? day + 40 : day)}${pad(month)}${pad(yy)}${noKartu.slice(-4)}`;
}

function birthFromNik(nik: string, today: string): { tglLahir: string; sex: 'L' | 'P' } | null {
  const info = nikBirthInfo(nik);
  if (!info) return null;
  const nowYY = Number(today.slice(2, 4));
  const year = (info.yearSuffix > nowYY ? 1900 : 2000) + info.yearSuffix;
  const date = new Date(Date.UTC(year, info.month - 1, info.day));
  if (date.getUTCDate() !== info.day) return null; // mis. 31 Februari
  return { tglLahir: date.toISOString().slice(0, 10), sex: info.sex };
}

/** `54 tahun ,6 bulan ,21 hari` (format teks umur VClaim). */
function umurText(tglLahir: string, pada: string): string {
  const [y1, m1, d1] = tglLahir.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = pada.split('-').map(Number) as [number, number, number];
  let years = y2 - y1;
  let months = m2 - m1;
  let days = d2 - d1;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${Math.max(0, years)} tahun ,${months} bulan ,${days} hari`;
}

function buildPeserta(
  state: BpjsState,
  noKartu: string,
  nik: string,
  tglPelayanan: string,
  today: string,
): VclaimPeserta {
  const ov = state.pesertaOverride.get(noKartu);
  const h = digest(`peserta:${noKartu}`);
  const birth = birthFromNik(nik, today);
  const fallback = fakePerson(nik);
  const tglLahir = ov?.tglLahir ?? birth?.tglLahir ?? fallback.tanggalLahir;
  const sex = ov?.sex ?? birth?.sex ?? (fallback.jenisKelamin as 'L' | 'P');
  const aktif = ov?.aktif ?? !(noKartu.endsWith('0000') || nik.endsWith('0000'));
  const kelas = ov?.hakKelas ?? (String(1 + ((h[0] ?? 0) % 3)) as '1' | '2' | '3');
  const fktp = MOCK_FKTP[(h[2] ?? 0) % MOCK_FKTP.length] ?? MOCK_FKTP[0];
  return {
    noKartu,
    nik,
    nama: (ov?.nama ?? fallback.nama).toUpperCase(),
    pisa: '1',
    sex,
    tglLahir,
    tglCetakKartu: '2016-01-15',
    tglTMT: '2016-01-01',
    tglTAT: aktif ? '2099-12-31' : bpjsAddDays(today, -30),
    statusPeserta: aktif
      ? { kode: VCLAIM_PESERTA_AKTIF, keterangan: 'AKTIF' }
      : { kode: '1', keterangan: 'TIDAK AKTIF' },
    hakKelas: { kode: kelas, keterangan: KELAS[kelas] },
    jenisPeserta: JENIS_PESERTA[(h[1] ?? 0) % JENIS_PESERTA.length] ?? JENIS_PESERTA[0],
    provUmum: { kdProvider: fktp.kode, nmProvider: fktp.nama },
    mr: { noMR: null, noTelepon: null },
    umur: { umurSekarang: umurText(tglLahir, today), umurSaatPelayanan: umurText(tglLahir, tglPelayanan) },
    informasi: { dinsos: null, prolanisPRB: null, noSKTM: null, eSEP: null },
    cob: { noAsuransi: null, nmAsuransi: null, tglTAT: null, tglTMT: null },
  };
}

function remember(state: BpjsState, noKartu: string, nik: string): void {
  if (!state.nikByKartu.has(noKartu)) state.nikByKartu.set(noKartu, nik);
  if (!state.kartuByNik.has(nik)) state.kartuByNik.set(nik, noKartu);
}

/** Peserta per no. kartu; null = tidak ditemukan. */
export function pesertaByKartu(
  state: BpjsState,
  noKartu: string,
  tglPelayanan: string,
  today: string,
): VclaimPeserta | null {
  if (!isFictionalKartu(noKartu) || noKartu.endsWith('9999')) return null;
  const nik = state.nikByKartu.get(noKartu) ?? fakeNikFromKartu(noKartu);
  if (nik.endsWith('9999')) return null;
  remember(state, noKartu, nik);
  return buildPeserta(state, noKartu, nik, tglPelayanan, today);
}

/** Peserta per NIK; null = tidak ditemukan. */
export function pesertaByNik(
  state: BpjsState,
  nik: string,
  tglPelayanan: string,
  today: string,
): VclaimPeserta | null {
  if (!/^9999\d{12}$/.test(nik) || nik.endsWith('9999')) return null;
  const noKartu = state.kartuByNik.get(nik) ?? fakeBpjsCard(nik);
  if (noKartu.endsWith('9999')) return null;
  remember(state, noKartu, nik);
  return buildPeserta(state, noKartu, nik, tglPelayanan, today);
}

export function pesertaAktif(p: VclaimPeserta): boolean {
  return p.statusPeserta.kode === VCLAIM_PESERTA_AKTIF;
}
