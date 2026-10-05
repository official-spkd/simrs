export const APP_TIME_ZONE = 'Asia/Jakarta';

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface JakartaParts {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
  weekday: number;
}

export function jakartaParts(input: Date | string): JakartaParts {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) throw new RangeError('Tanggal tidak valid');
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: p.hour ?? '00',
    minute: p.minute ?? '00',
    weekday: WEEKDAY_INDEX[p.weekday ?? 'Sun'] ?? 0,
  };
}

/** `Sen, 5 Okt 2026` */
export function formatTanggal(input: Date | string): string {
  const p = jakartaParts(input);
  return `${HARI[p.weekday]}, ${p.day} ${BULAN[p.month - 1]} ${p.year}`;
}

/** `07.10` */
export function formatJam(input: Date | string): string {
  const p = jakartaParts(input);
  return `${p.hour}.${p.minute}`;
}

/** `Sen, 5 Okt 2026 · 07.10` (zona Asia/Jakarta) */
export function formatTanggalWaktu(input: Date | string): string {
  return `${formatTanggal(input)} · ${formatJam(input)}`;
}

/** Periode `YYMM` untuk penomoran dokumen (mis. `2610`). */
export function periodYYMM(input: Date | string): string {
  const p = jakartaParts(input);
  return `${String(p.year % 100).padStart(2, '0')}${String(p.month).padStart(2, '0')}`;
}

/**
 * Periode harian `YYMMDD` untuk penomoran (mis. `261005`). Tanggal kalender `YYYY-MM-DD` (tanggal layanan) dipakai
 * apa adanya; instan waktu dihitung di WIB, sehingga 23.30 WIB tetap hari yang sama walau UTC sudah berganti hari.
 */
export function periodYYMMDD(input: Date | string): string {
  const date = typeof input === 'string' ? /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(input) : null;
  if (date) {
    const utc = new Date(`${input as string}T00:00:00Z`);
    if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== input) {
      throw new RangeError('Tanggal tidak valid');
    }
    return `${date[1]}${date[2]}${date[3]}`;
  }
  const p = jakartaParts(input);
  return `${String(p.year % 100).padStart(2, '0')}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/** Tanggal kalender WIB `YYYY-MM-DD` (mis. "hari ini" untuk validasi tanggal lahir). */
export function isoDateJakarta(input: Date | string = new Date()): string {
  const p = jakartaParts(input);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Tanggal saja dari `YYYY-MM-DD` (tanpa zona): `14 Mar 1972`. Untuk tanggal lahir. */
export function formatTanggalLahir(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${d} ${BULAN[m - 1] ?? '?'} ${y}`;
}

/** Tanggal tanpa tahun dari `YYYY-MM-DD`: `14 Mar`. Konfirmasi identitas di anjungan (tahun lahir tidak ditampilkan). */
export function formatHariBulan(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return `${d} ${BULAN[m - 1] ?? '?'}`;
}
