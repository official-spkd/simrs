import { type EmarMedication, jakartaParts } from '@simrs/shared';
import { wristbandMatches } from './rawat-inap';
import { hasReason } from './rme';

/**
 * K12 · Asuhan keperawatan: diagnosis keperawatan (master lokal tanpa kode resmi, selaras SDKI; keputusan fase 3
 * no. 15), luaran dengan kriteria, intervensi per shift, evaluasi SOAP per diagnosis per shift; dan gerbang eMAR
 * di ronde obat shift: gelang belum terverifikasi = pemberian tidak bisa dicatat (CLAUDE.md §4.9).
 */

export type Shift = 'pagi' | 'siang' | 'malam';

export const SHIFT_LABEL: Record<Shift, string> = {
  pagi: 'Pagi 07.00–14.00',
  siang: 'Siang 14.00–21.00',
  malam: 'Malam 21.00–07.00',
};

/** Shift dari jam WIB. */
export function shiftOf(iso: string): Shift {
  const h = Number(jakartaParts(iso).hour);
  if (h >= 7 && h < 14) return 'pagi';
  if (h >= 14 && h < 21) return 'siang';
  return 'malam';
}

export interface NursingDx {
  id: string;
  label: string;
  since: string;
  /** Luaran (target + kriteria hasil). */
  outcome: string;
  interventions: ReadonlyArray<{ id: string; label: string }>;
}

export type EvalResult = 'teratasi' | 'sebagian' | 'belum';

export const EVAL_LABEL: Record<EvalResult, string> = {
  teratasi: 'Masalah teratasi',
  sebagian: 'Teratasi sebagian',
  belum: 'Belum teratasi',
};

export interface ShiftEval {
  id: string;
  dxId: string;
  shift: Shift;
  /** Tanggal shift `YYYY-MM-DD` (shift malam = tanggal mulai). */
  date: string;
  s: string;
  o: string;
  result: EvalResult;
  p: string;
  by: string;
  at: string;
}

export interface EvalDraft {
  s: string;
  o: string;
  result: EvalResult | '';
  p: string;
}

export function evalBlocker(d: EvalDraft): string | null {
  if (!d.o.trim()) return 'Isi O (data objektif) evaluasi.';
  if (!d.result) return 'Pilih hasil evaluasi (A).';
  if (!d.p.trim()) return 'Isi P (rencana lanjut).';
  return null;
}

/** Diagnosis yang sudah dievaluasi pada shift + tanggal ini. */
export function shiftProgress(
  dxs: readonly NursingDx[],
  evals: readonly ShiftEval[],
  shift: Shift,
  date: string,
): { done: number; total: number } {
  const done = dxs.filter((d) => evals.some((e) => e.dxId === d.id && e.shift === shift && e.date === date));
  return { done: done.length, total: dxs.length };
}

export const interventionKey = (dxId: string, intvId: string, shift: Shift, date: string) =>
  `${dxId}|${intvId}|${shift}|${date}`;

// ---------------------------------------------------------------------------------------------------------
// Ronde obat shift (eMAR): gerbang gelang
// ---------------------------------------------------------------------------------------------------------

export interface DueDose {
  key: string;
  medicationId: string;
  name: string;
  sig: string;
  time: string;
  highAlert: boolean;
  late: boolean;
}

/** Dosis jatuh tempo atau terlambat (belum diberikan) dari jadwal eMAR. */
export function dueDoses(meds: readonly EmarMedication[]): DueDose[] {
  return meds.flatMap((m) =>
    m.slots
      .filter((s) => s.state === 'jadwal' || s.state === 'terlambat')
      .map((s) => ({
        key: `${m.id}|${s.time}`,
        medicationId: m.id,
        name: m.name,
        sig: m.sig,
        time: s.time,
        highAlert: m.highAlert,
        late: s.state === 'terlambat',
      })),
  );
}

export type ScanState =
  { status: 'belum' } | { status: 'cocok'; at: string } | { status: 'tidak-cocok'; code: string };

/** Hasil pindai gelang: cocok hanya bila kode = RM pasien (simulasi kode gelang). */
export function scanWristband(code: string, rm: string, at: string): ScanState {
  return wristbandMatches(code, rm) ? { status: 'cocok', at } : { status: 'tidak-cocok', code: code.trim() };
}

export const WRISTBAND_GATE =
  'Pindai gelang pasien dulu: pemberian obat tidak bisa dicatat sebelum identitas terverifikasi.';

/** Gerbang catat pemberian satu dosis. Null = boleh dicatat. */
export function recordDoseBlocker(
  dose: Pick<DueDose, 'late' | 'highAlert'>,
  o: { scan: ScanState; lateReason: string; secondNurse: string },
): string | null {
  if (o.scan.status !== 'cocok') return WRISTBAND_GATE;
  if (dose.late && !hasReason(o.lateReason))
    return 'Dosis terlambat: alasan keterlambatan wajib (minimal 10 karakter).';
  if (dose.highAlert && !o.secondNurse) return 'Obat high-alert: cek ganda oleh perawat kedua wajib.';
  return null;
}
