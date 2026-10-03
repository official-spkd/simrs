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
