/**
 * B03 · SDM dan kepegawaian (rencana fase 8 §8.2): masa berlaku STR/SIP, NIK tersamar, jadwal dinas per unit
 * (draf → terbit) dengan gerbang jumlah minimum per dinas dan jeda istirahat. Fungsi murni untuk layar mode
 * presentasi (ADR-0023); pengaturan `credential.expiry_warning_days` = 60.
 */

export const LICENSE_WARN_DAYS = 60;

const DAY_MS = 86_400_000;
function dayNumber(iso: string): number {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export type LicenseStatus = 'aktif' | 'segera' | 'kedaluwarsa';

export interface License {
  kind: 'STR' | 'SIP';
  number: string;
  /** `YYYY-MM-DD`; STR seumur hidup = null (UU 17/2023). */
  expiry: string | null;
}

export function licenseStatus(
  expiry: string | null,
  today: string,
  warnDays = LICENSE_WARN_DAYS,
): { status: LicenseStatus; days: number | null } {
  if (expiry === null) return { status: 'aktif', days: null };
  const days = daysBetween(today, expiry);
  if (days < 0) return { status: 'kedaluwarsa', days };
  return { status: days <= warnDays ? 'segera' : 'aktif', days };
}

const RANK: Record<LicenseStatus, number> = { aktif: 0, segera: 1, kedaluwarsa: 2 };

/** Status terburuk dari semua izin pegawai. */
export function worstLicense(
  licenses: readonly License[],
  today: string,
): { status: LicenseStatus; license: License | null; days: number | null } {
  let worst: { status: LicenseStatus; license: License | null; days: number | null } = {
    status: 'aktif',
    license: null,
    days: null,
  };
  for (const l of licenses) {
    const s = licenseStatus(l.expiry, today);
    if (
      RANK[s.status] > RANK[worst.status] ||
      (s.status === worst.status && s.days !== null && (worst.days === null || s.days < worst.days))
    ) {
      worst = { status: s.status, license: l, days: s.days };
    }
  }
  return worst;
}

export function licenseText(status: LicenseStatus, days: number | null): string {
  if (status === 'kedaluwarsa') return `Kedaluwarsa ${days === null ? '' : `${-days} hari`}`.trim();
  if (status === 'segera') return `Berakhir ${days} hari lagi`;
  return days === null ? 'Seumur hidup' : 'Berlaku';
}

/** NIK tersamar: 4 digit awal dan 4 akhir terlihat. */
export function maskNik(nik: string): string {
  const d = nik.replace(/\D/g, '');
  if (d.length < 8) return '••••';
  return `${d.slice(0, 4)}${'•'.repeat(d.length - 8)}${d.slice(-4)}`;
}

/** Nama panggilan untuk sel jadwal: "Ns. Maya Sari, S.Kep" → "Maya". */
export function shortName(name: string): string {
  const base = (name.split(',')[0] ?? name).replace(/^(dr\.|Ns\.|Bd\.|apt\.)\s+/i, '');
  return base.split(/\s+/)[0] ?? base;
}

// ---------------------------------------------------------------------------------------------------------------
// Jadwal dinas

export type Shift = 'P' | 'S' | 'M';
export const SHIFTS: readonly Shift[] = ['P', 'S', 'M'];
export const SHIFT_LABEL: Record<Shift, string> = { P: 'Pagi', S: 'Siang', M: 'Malam' };
export const SHIFT_HOURS: Record<Shift, number> = { P: 7, S: 7, M: 10 };

/** Jadwal satu unit: `cells[hari][dinas]` = id pegawai; hari 0 = Senin. */
export type Roster = Record<number, Record<Shift, readonly string[]>>;

export interface RosterGap {
  day: number;
  shift: Shift;
  have: number;
  need: number;
}

export function rosterGaps(roster: Roster, days: number, minimum: Record<Shift, number>): RosterGap[] {
  const gaps: RosterGap[] = [];
  for (let day = 0; day < days; day++) {
    for (const shift of SHIFTS) {
      const have = roster[day]?.[shift]?.length ?? 0;
      if (have < minimum[shift]) gaps.push({ day, shift, have, need: minimum[shift] });
    }
  }
  return gaps;
}

/** Dinas malam lalu dinas pagi keesokan harinya (jeda istirahat < 8 jam). */
export function restViolations(roster: Roster, days: number): Array<{ staffId: string; day: number }> {
  const out: Array<{ staffId: string; day: number }> = [];
  for (let day = 0; day < days - 1; day++) {
    const night = roster[day]?.M ?? [];
    const morning = roster[day + 1]?.P ?? [];
    for (const id of night) if (morning.includes(id)) out.push({ staffId: id, day: day + 1 });
  }
  return out;
}

export function weeklyHours(roster: Roster, staffId: string): number {
  let h = 0;
  for (const cells of Object.values(roster)) {
    for (const shift of SHIFTS) if (cells[shift]?.includes(staffId)) h += SHIFT_HOURS[shift];
  }
  return h;
}

/** Gerbang terbit: semua dinas memenuhi minimum dan tidak ada jeda istirahat yang dilanggar. */
export function publishBlock(gaps: readonly RosterGap[], violations: readonly unknown[]): string | null {
  if (gaps.length > 0) return `${gaps.length} dinas di bawah jumlah minimum; isi dulu sebelum terbit.`;
  if (violations.length > 0) return `${violations.length} jeda istirahat malam → pagi dilanggar; ubah dulu.`;
  return null;
}

export function assign(roster: Roster, day: number, shift: Shift, staffId: string): Roster {
  const cur = roster[day] ?? { P: [], S: [], M: [] };
  if (cur[shift].includes(staffId)) return roster;
  return { ...roster, [day]: { ...cur, [shift]: [...cur[shift], staffId] } };
}

export function unassign(roster: Roster, day: number, shift: Shift, staffId: string): Roster {
  const cur = roster[day];
  if (!cur) return roster;
  return { ...roster, [day]: { ...cur, [shift]: cur[shift].filter((x) => x !== staffId) } };
}
