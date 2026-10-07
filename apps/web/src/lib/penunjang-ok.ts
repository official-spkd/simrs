import {
  type ChecklistPhase,
  type ChecklistPhaseId,
  formatJam,
  formatTanggal,
  type InstrumentCount,
  type OrCase,
  type OrCaseStatus,
} from '@simrs/shared';

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

/**
 * Bukti time out untuk mencatat insisi tanpa override (diperiksa Server Action): daftar tilik yang dikirim layar harus
 * milik kasus itu (fase dan butir sama, fase yang sudah dikonfirmasi di server tidak dibatalkan), sign in dan time
 * out dikonfirmasi dengan semua butir tercentang, dan insisi belum tercatat. null = sah.
 */
export function incisionEvidenceError(
  server: Pick<OrCase, 'checklist' | 'incisionAt'>,
  claimed: readonly ChecklistPhase[],
): string | null {
  if (server.incisionAt) return 'Insisi kasus ini sudah tercatat.';
  const same =
    claimed.length === server.checklist.length &&
    server.checklist.every((p, i) => {
      const q = claimed[i];
      return (
        !!q &&
        q.phase === p.phase &&
        q.items.length === p.items.length &&
        p.items.every((item, j) => q.items[j]?.id === item.id) &&
        (!p.confirmedAt || !!q.confirmedAt)
      );
    });
  if (!same) return 'Daftar tilik tidak cocok dengan kasus ini.';
  const done = (id: ChecklistPhaseId) => {
    const p = claimed.find((x) => x.phase === id);
    return !!p?.confirmedAt && p.items.every((i) => i.checked);
  };
  if (!done('sign-in') || !done('time-out')) {
    return 'Insisi ditolak: sign in dan time out harus lengkap dan dikonfirmasi, atau gunakan override beralasan.';
  }
  return null;
}

/** Label pasien skenario beserta tanggalnya di garis waktu Simulasi; null = bukan pasien skenario. */
export function scenarioCaseNote(c: Pick<OrCase, 'scenario' | 'scenarioDate'>): string | null {
  if (!c.scenario) return null;
  return c.scenarioDate
    ? `Pasien skenario Simulasi · ${formatTanggal(`${c.scenarioDate}T12:00:00+07:00`)}`
    : 'Pasien skenario Simulasi · menunggu langkah operasi';
}

/** Override gerbang time out: alasan klinis wajib, minimal sekian karakter (tercatat dan dapat ditinjau). */
export const OVERRIDE_REASON_MIN = 15;

/** Catatan lokal layar (mode presentasi: tidak disimpan) di atas data server satu kasus. */
export interface OkLocal {
  checked: Readonly<Record<string, boolean>>;
  confirmed: Readonly<Partial<Record<ChecklistPhaseId, string>>>;
  finals: Readonly<Record<string, number | null>>;
  incisionAt: string | null;
  overrideReason: string | null;
  finishedAt: string | null;
  movedAt: string | null;
}

export const EMPTY_LOCAL: OkLocal = {
  checked: {},
  confirmed: {},
  finals: {},
  incisionAt: null,
  overrideReason: null,
  finishedAt: null,
  movedAt: null,
};

/**
 * Kasus efektif = data server + catatan lokal. Fase yang sudah dikonfirmasi di server (mis. oleh skenario) menang;
 * butir dan hitung akhir hanya bisa berubah di fase yang belum dikonfirmasi.
 */
export function withLocal(c: OrCase, l: OkLocal, by: string): OrCase {
  const signOutDone = !!c.checklist.find((p) => p.phase === 'sign-out')?.confirmedAt;
  const checklist = c.checklist.map((p) => {
    if (p.confirmedAt) return p;
    const at = l.confirmed[p.phase] ?? null;
    return {
      ...p,
      items: p.items.map((i) => ({ ...i, checked: l.checked[i.id] ?? i.checked })),
      confirmedAt: at,
      confirmedBy: at ? by : null,
    };
  });
  const counts = c.counts.map((x) =>
    signOutDone || !Object.hasOwn(l.finals, x.id) ? x : { ...x, final: l.finals[x.id] ?? null },
  );
  const started = !!checklist[0]?.confirmedAt;
  let status = c.status;
  let statusNote = c.statusNote;
  if (l.finishedAt && c.status !== 'selesai') {
    status = 'selesai';
    statusNote = `selesai ${formatJam(l.finishedAt)}`;
  } else if (started && (c.status === 'terjadwal' || c.status === 'cito')) {
    status = 'berjalan';
    statusNote = 'sign in dikonfirmasi';
  }
  // Jam insisi yang dicatat di layar ini menang atas proyeksi server (mis. jam tugas `tilik` skenario).
  return { ...c, checklist, counts, status, statusNote, incisionAt: l.incisionAt ?? c.incisionAt };
}
