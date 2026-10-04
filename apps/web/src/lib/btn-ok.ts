import type { ChecklistPhase, ChecklistPhaseId, InstrumentCount, OrCase, OrCaseStatus } from '@simrs/shared';

/**
 * S06 · Logika murni kamar operasi: posisi blok Gantt, fase daftar tilik keselamatan WHO, hitung kasa, dan gerbang
 * time out (CLAUDE.md §4.9: insisi tidak bisa dicatat sebelum time out lengkap, kecuali override beralasan).
 */

export const PHASE_LABEL: Record<ChecklistPhaseId, string> = {
  'sign-in': 'Sign in',
  'time-out': 'Time out',
  'sign-out': 'Sign out',
};

export const PHASE_WHEN: Record<ChecklistPhaseId, string> = {
  'sign-in': 'Sebelum induksi',
  'time-out': 'Sebelum insisi',
  'sign-out': 'Sebelum pasien keluar kamar',
};

export const CASE_STATUS_LABEL: Record<OrCaseStatus, string> = {
  selesai: 'Selesai',
  berjalan: 'Sedang berlangsung',
  terjadwal: 'Terjadwal',
  cito: 'Cito',
};

/** Butir sign out yang mengikuti hasil hitung akhir (tidak dicentang manual). */
export const COUNT_ITEM = 'sign-out-2';

/** Persentase posisi blok di sumbu jam (07.00–16.00). */
export function ganttBox(
  startMin: number,
  durationMin: number,
  dayStart: number,
  dayEnd: number,
): { left: number; width: number } {
  const span = dayEnd - dayStart;
  const s = Math.max(dayStart, Math.min(dayEnd, startMin));
  const e = Math.max(s, Math.min(dayEnd, startMin + durationMin));
  return { left: ((s - dayStart) / span) * 100, width: ((e - s) / span) * 100 };
}

export function minutesLabel(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}.${String(min % 60).padStart(2, '0')}`;
}

export interface CountCheck {
  filled: number;
  total: number;
  mismatches: string[];
  ok: boolean;
}

/** Hitung akhir harus terisi semua dan sama dengan hitung awal. */
export function checkCounts(counts: readonly InstrumentCount[]): CountCheck {
  const mismatches: string[] = [];
  let filled = 0;
  for (const c of counts) {
    if (c.final === null) continue;
    filled++;
    if (c.final !== c.initial) mismatches.push(`${c.label.toLowerCase()} ${c.final} dari ${c.initial}`);
  }
  return {
    filled,
    total: counts.length,
    mismatches,
    ok: filled === counts.length && mismatches.length === 0,
  };
}

/** Indeks fase aktif: fase pertama yang belum dikonfirmasi (3 = semua lengkap). */
export function currentPhase(checklist: readonly ChecklistPhase[]): number {
  const i = checklist.findIndex((p) => !p.confirmedAt);
  return i < 0 ? checklist.length : i;
}

/** Butir tercentang efektif (butir hitung kasa sign out mengikuti hasil hitung). */
export function itemChecked(
  phase: ChecklistPhase,
  itemId: string,
  counts: readonly InstrumentCount[],
): boolean {
  if (phase.phase === 'sign-out' && itemId === COUNT_ITEM)
    return !!phase.confirmedAt || checkCounts(counts).ok;
  return phase.items.find((i) => i.id === itemId)?.checked ?? false;
}

export function phaseRemaining(phase: ChecklistPhase, counts: readonly InstrumentCount[]): number {
  return phase.items.filter((i) => !itemChecked(phase, i.id, counts)).length;
}

/** Fase boleh dikonfirmasi bila ia fase aktif dan semua butirnya lengkap. */
export function canConfirmPhase(c: Pick<OrCase, 'checklist' | 'counts'>, index: number): boolean {
  const phase = c.checklist[index];
  return !!phase && currentPhase(c.checklist) === index && phaseRemaining(phase, c.counts) === 0;
}

/** Gerbang time out: insisi hanya bila time out sudah dikonfirmasi. */
export function timeOutComplete(checklist: readonly ChecklistPhase[]): boolean {
  return !!checklist.find((p) => p.phase === 'time-out')?.confirmedAt;
}

export type IncisionGate = { allowed: true } | { allowed: false; reason: string; remaining: number };

export function incisionGate(c: Pick<OrCase, 'checklist' | 'counts'>): IncisionGate {
  if (timeOutComplete(c.checklist)) return { allowed: true };
  const signIn = c.checklist.find((p) => p.phase === 'sign-in');
  const timeOut = c.checklist.find((p) => p.phase === 'time-out');
  if (!signIn?.confirmedAt) {
    return {
      allowed: false,
      reason: 'Sign in belum dikonfirmasi; induksi dan insisi terkunci.',
      remaining: 10,
    };
  }
  const remaining = timeOut ? phaseRemaining(timeOut, c.counts) : 5;
  return {
    allowed: false,
    reason: remaining
      ? `Time out belum lengkap (${remaining} butir tersisa). Insisi terkunci sampai time out dikonfirmasi.`
      : 'Time out lengkap tetapi belum dikonfirmasi. Konfirmasi time out untuk membuka insisi.',
    remaining,
  };
}
