import type { SupportErrorCode } from '../errors';
import {
  CHECKLIST_PHASES,
  type ChecklistPhase,
  type ChecklistPhaseId,
  type InstrumentCount,
  type OrCase,
  SURGERY_OVERRIDE_REASON_MIN,
} from '../schemas/kamar-operasi';

/**
 * S06 · Aturan murni kamar operasi (rencana fase 4 §4.0a/§4.7, keputusan no. 14): daftar tilik WHO berurutan, hitung
 * kasa, dan gerbang insisi. Fungsi demo (`OrCase`) dipindah dari `apps/web/src/lib/btn-ok.ts`; gerbang server di
 * bagian bawah bekerja atas data tabel dan juga dijaga trigger database.
 */

/** Butir sign out yang mengikuti hasil hitung akhir (tidak dicentang manual). */
export const COUNT_ITEM = 'sign-out-2';

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

/**
 * Fase boleh dikonfirmasi bila ia fase aktif dan semua butirnya lengkap. Sign out (sebelum pasien keluar kamar)
 * juga menuntut insisi sudah dicatat: tanpa insisi tidak ada operasi yang ditutup.
 */
export function canConfirmPhase(
  c: Pick<OrCase, 'checklist' | 'counts' | 'incisionAt'>,
  index: number,
): boolean {
  const phase = c.checklist[index];
  if (!phase || currentPhase(c.checklist) !== index || phaseRemaining(phase, c.counts) !== 0) return false;
  return phase.phase !== 'sign-out' || !!c.incisionAt;
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

// ───────────────────────────── Gerbang server (data tabel) ─────────────────────────────

/**
 * Konfirmasi satu fase: urutan sign in → time out → sign out (`CHECKLIST_ORDER`), semua butir fase tercentang
 * (`CHECKLIST_INCOMPLETE`), dan sign out butuh insisi tercatat + hitung akhir cocok atau selisih ditindaklanjuti
 * (`COUNT_MISMATCH`).
 */
export function checklistConfirmBlock(s: {
  phase: ChecklistPhaseId;
  confirmedPhases: readonly ChecklistPhaseId[];
  uncheckedItems: number;
  incisionRecorded: boolean;
  countsReconciled: boolean;
}): Extract<SupportErrorCode, 'CHECKLIST_ORDER' | 'CHECKLIST_INCOMPLETE' | 'COUNT_MISMATCH'> | null {
  const index = CHECKLIST_PHASES.indexOf(s.phase);
  const expected = CHECKLIST_PHASES.find((p) => !s.confirmedPhases.includes(p));
  if (expected !== s.phase || CHECKLIST_PHASES.slice(0, index).some((p) => !s.confirmedPhases.includes(p))) {
    return 'CHECKLIST_ORDER';
  }
  if (s.uncheckedItems > 0) return 'CHECKLIST_INCOMPLETE';
  if (s.phase === 'sign-out' && (!s.incisionRecorded || !s.countsReconciled)) return 'COUNT_MISMATCH';
  return null;
}

/**
 * Insisi butuh time out terkonfirmasi, kecuali override dokter (`surgery.override`) dengan alasan ≥ batas RS
 * (bawaan 15 karakter) yang tercatat dan ditinjau mutu. Induksi butuh sign in.
 */
export function surgeryEventBlock(s: {
  kind: 'induksi' | 'insisi' | 'tutup' | 'keluar';
  confirmedPhases: readonly ChecklistPhaseId[];
  overrideReason: string | null;
  canOverride: boolean;
  minReason?: number;
}): Extract<SupportErrorCode, 'CHECKLIST_ORDER' | 'TIMEOUT_REQUIRED'> | null {
  if (s.kind === 'induksi' && !s.confirmedPhases.includes('sign-in')) return 'CHECKLIST_ORDER';
  if (s.kind === 'insisi' && !s.confirmedPhases.includes('time-out')) {
    const min = s.minReason ?? SURGERY_OVERRIDE_REASON_MIN;
    return s.canOverride && (s.overrideReason ?? '').trim().length >= min ? null : 'TIMEOUT_REQUIRED';
  }
  return null;
}

/**
 * Rekonsiliasi hitung: per butir, jumlah akhir = awal + tambahan; butir yang selisih harus punya tindak lanjut
 * tertulis. Mengembalikan kode butir yang belum beres (kosong = cocok).
 */
export function unreconciledCountItems(
  counts: ReadonlyArray<{ itemCode: string; kind: 'awal' | 'tambahan' | 'akhir'; quantity: number }>,
  resolvedItemCodes: readonly string[],
): string[] {
  const sum = new Map<string, { expected: number; final: number | null }>();
  for (const c of counts) {
    const cur = sum.get(c.itemCode) ?? { expected: 0, final: null };
    if (c.kind === 'akhir') cur.final = c.quantity;
    else cur.expected += c.quantity;
    sum.set(c.itemCode, cur);
  }
  return [...sum.entries()]
    .filter(([code, v]) => (v.final === null || v.final !== v.expected) && !resolvedItemCodes.includes(code))
    .map(([code]) => code);
}
