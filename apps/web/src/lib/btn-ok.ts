import {
  type ChecklistPhase,
  type ChecklistPhaseId,
  formatJam,
  formatTanggal,
  type OrCase,
  type OrCaseStatus,
} from '@simrs/shared';

/** Aturan murni dipindah ke `@simrs/shared/rules` (rencana fase 4 §4.0a); diekspor ulang untuk pemakai lama. */
export {
  canConfirmPhase,
  checkCounts,
  COUNT_ITEM,
  type CountCheck,
  currentPhase,
  incisionGate,
  type IncisionGate,
  itemChecked,
  phaseRemaining,
  timeOutComplete,
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
