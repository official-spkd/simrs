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

export interface ChemoOrderInput {
  heightCm: number;
  weightKg: number;
  pct: number;
  reason: string;
}

/** Order siklus yang dikunci penulis: dasar perhitungan + dosis per obat yang diverifikasi ganda. */
export interface ChemoOrderLock {
  heightCm: number;
  weightKg: number;
  pct: number;
  bsa: number;
  doses: Readonly<Record<string, number>>;
}

/** TB 100–220 cm dan BB 25–200 kg. */
export const chemoInputValid = (h: number, w: number): boolean =>
  Number.isFinite(h) && Number.isFinite(w) && h >= 100 && h <= 220 && w >= 25 && w <= 200;

/** Kunci order: isian wajar + penyesuaian beralasan → potret dosis yang tidak berubah lagi. */
export function lockChemoOrder(
  input: ChemoOrderInput,
  drugs: ReadonlyArray<{ name: string; mgPerM2: number }>,
): { lock: ChemoOrderLock } | { block: string } {
  if (!chemoInputValid(input.heightCm, input.weightKg)) {
    return { block: 'Isi tinggi (100–220 cm) dan berat badan (25–200 kg) yang wajar.' };
  }
  const adjust = adjustmentBlock(input.pct, input.reason);
  if (adjust) return { block: adjust };
  const bsa = mosteller(input.heightCm, input.weightKg);
  return {
    lock: {
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      pct: input.pct,
      bsa,
      doses: Object.fromEntries(drugs.map((d) => [d.name, doseMg(d.mgPerM2, bsa, input.pct)])),
    },
  };
}

/**
 * Verifikasi ganda hanya atas order yang terkunci, dan hanya bila dasar perhitungan di layar masih sama dengan yang
 * dikunci (TB/BB/persen dosis berubah → order ditulis ulang, bukan diverifikasi).
 */
export function chemoVerifyBlock(
  lock: ChemoOrderLock | null,
  current: Pick<ChemoOrderInput, 'heightCm' | 'weightKg' | 'pct'>,
): string | null {
  if (!lock) return 'Kunci order siklus dulu; yang diverifikasi adalah dosis yang ditulis.';
  if (lock.heightCm !== current.heightCm || lock.weightKg !== current.weightKg || lock.pct !== current.pct) {
    return 'Dasar perhitungan berubah setelah order dikunci: tulis ulang order, jangan diverifikasi.';
  }
  return null;
}

export function addDays(iso: string, days: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
