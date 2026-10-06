/**
 * B11 · Onkologi (rencana fase 8 §8.5, struktur dasar): luas permukaan tubuh Mosteller, dosis berbasis mg/m² dengan
 * penyesuaian beralasan, gerbang laboratorium pra-kemoterapi (nilai di bawah ambang menahan siklus kecuali override
 * beralasan), dan verifikasi ganda oleh dua pelaku berbeda. Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

/** LPT Mosteller (m²) = √(TB cm × BB kg ÷ 3600), dua desimal. */
export function mosteller(heightCm: number, weightKg: number): number {
  if (heightCm <= 0 || weightKg <= 0) return 0;
  return Math.round(Math.sqrt((heightCm * weightKg) / 3600) * 100) / 100;
}

/** Dosis (mg, bulat) = mg/m² × LPT × persen penyesuaian. */
export function doseMg(mgPerM2: number, bsa: number, pct = 100): number {
  return Math.round((mgPerM2 * bsa * pct) / 100);
}

export interface LabValue {
  label: string;
  value: number;
  unit: string;
  /** Ambang minimal agar siklus boleh diberikan. */
  min: number;
}

/** Nilai laboratorium di bawah ambang. */
export function labFailures(labs: readonly LabValue[]): LabValue[] {
  return labs.filter((l) => l.value < l.min);
}

/** Penyesuaian dosis < 100% wajib alasan. */
export function adjustmentBlock(pct: number, reason: string): string | null {
  if (pct < 100 && reason.trim().length < 10) return 'Penyesuaian dosis wajib alasan minimal 10 huruf.';
  return null;
}

/** Verifikasi ganda: dua verifikator berbeda dan bukan penulis order. */
export function verifierBlock(
  writer: string,
  first: string | null,
  second: string | null,
  step: 1 | 2,
): string | null {
  const who = step === 1 ? first : second;
  if (!who) return 'Pilih verifikator.';
  if (who === writer) return 'Verifikator harus berbeda dari penulis order.';
  if (step === 2 && who === first) return 'Verifikator kedua harus berbeda dari verifikator pertama.';
  return null;
}

export function addDays(iso: string, days: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
