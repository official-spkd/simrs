import type { ScenarioDef } from './types';

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad = (n: number) => String(n).padStart(2, '0');

function startParts(def: ScenarioDef): [number, number, number] {
  const [y = 2026, m = 1, d = 1] = def.startDate.split('-').map(Number);
  return [y, m, d];
}

/** Jam simulasi: "07.10", atau "Sab 3 Okt · 21.40" untuk skenario lintas hari (mockup Simulasi). */
export function formatSimClock(def: ScenarioDef, minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const rest = minutes - day * 1440;
  const hm = `${pad(Math.floor(rest / 60))}.${pad(rest % 60)}`;
  if (!def.showDay) return hm;
  const [y, m, d] = startParts(def);
  const dt = new Date(Date.UTC(y, m - 1, d + day));
  return `${HARI[dt.getUTCDay()]} ${dt.getUTCDate()} ${BULAN[dt.getUTCMonth()]} · ${hm}`;
}

/** Tanggal mulai panjang: "Senin 5 Okt 2026". */
export function formatSimDate(def: ScenarioDef): string {
  const [y, m, d] = startParts(def);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dt.getUTCDay()];
  return `${hari} ${d} ${BULAN[m - 1]} ${y}`;
}

/** Durasi: "45 mnt", "3 j 19 mnt", "4 hr 10 j". */
export function formatSimDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} mnt`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} j${m ? ` ${m} mnt` : ''}`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return `${d} hr${h ? ` ${h} j` : ''}`;
}

/** Instan nyata (WIB, UTC+7) dari menit simulasi; dipakai menempatkan pasien skenario di data layar lain. */
export function simInstant(def: ScenarioDef, minutes: number): Date {
  const [y, m, d] = startParts(def);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - 7 * 3_600_000);
}

export type LogKind = 'bpjs' | 'satusehat' | 'keselamatan' | 'pembayaran' | 'internal';

/** Kelompok pesan integrasi dari label sistem (warna tag jejak sistem dan penghitung). */
export function logKind(sys: string): LogKind {
  if (!sys) return 'internal';
  if (sys.startsWith('BPJS') || sys.startsWith('E-Klaim')) return 'bpjs';
  if (sys.startsWith('SATUSEHAT')) return 'satusehat';
  if (sys.startsWith('Keselamatan')) return 'keselamatan';
  if (sys.startsWith('TPDI') || sys.startsWith('BTN')) return 'pembayaran';
  return 'internal';
}
