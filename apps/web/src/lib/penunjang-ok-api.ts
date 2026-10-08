import {
  type ChecklistPhaseId,
  formatJam,
  type OrCaseStatus,
  type SurgeryBoard,
  type SurgeryCaseView,
} from '@simrs/shared';
import type { GanttRoom } from '@/components/penunjang/ok-gantt';

/**
 * S06 · Pemetaan papan kamar operasi API (4.7) ke tampilan layar (murni, diuji tanpa browser): Gantt dipakai bersama
 * mode presentasi; daftar tilik, peristiwa, dan hitung dibaca dari kasus API apa adanya.
 */

export const API_STATUS_LABEL: Record<SurgeryCaseView['status'], string> = {
  terjadwal: 'Terjadwal',
  persiapan: 'Persiapan (sign in)',
  berjalan: 'Sedang berlangsung',
  selesai: 'Selesai',
  batal: 'Batal',
};

export const EVENT_LABEL: Record<SurgeryCaseView['events'][number]['kind'], string> = {
  induksi: 'Induksi',
  insisi: 'Insisi',
  tutup: 'Luka ditutup',
  keluar: 'Pasien keluar kamar',
};

/** Status blok Gantt: cito yang belum mulai ditandai cito. */
export function ganttStatus(c: Pick<SurgeryCaseView, 'status' | 'priority'>): OrCaseStatus {
  if (c.status === 'selesai') return 'selesai';
  if (c.status === 'berjalan') return 'berjalan';
  return c.priority === 'cito' ? 'cito' : 'terjadwal';
}

export function statusNote(c: SurgeryCaseView): string {
  const last = c.events.at(-1);
  if (c.status === 'selesai' && last) return `selesai ${formatJam(last.at)}`;
  if (last) return `${EVENT_LABEL[last.kind].toLowerCase()} ${formatJam(last.at)}`;
  const confirmed = c.checklist.filter((p) => p.confirmedAt).length;
  return confirmed ? `${confirmed}/3 fase daftar tilik` : c.caseNo;
}

export function ganttRooms(board: SurgeryBoard): GanttRoom[] {
  return board.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.code,
    cases: r.cases.map((c) => ({
      id: c.id,
      startMin: c.startMin,
      durationMin: c.durationMin,
      status: ganttStatus(c),
      statusNote: statusNote(c),
      procedure: c.procedureName,
      scenario: false,
      scenarioDate: null,
      patient: { name: c.patient.name },
    })),
  }));
}

/** Fase aktif = fase pertama yang belum dikonfirmasi; null = semua fase selesai. */
export function activePhase(c: Pick<SurgeryCaseView, 'checklist'>): ChecklistPhaseId | null {
  return c.checklist.find((p) => !p.confirmedAt)?.phase ?? null;
}

/** Butir manual yang belum dicentang pada satu fase (butir sistem tidak dihitung). */
export function manualRemaining(c: Pick<SurgeryCaseView, 'checklist'>, phase: ChecklistPhaseId): number {
  const p = c.checklist.find((x) => x.phase === phase);
  return p ? p.items.filter((i) => !i.system && !i.checked).length : 0;
}

export function hasEvent(
  c: Pick<SurgeryCaseView, 'events'>,
  kind: SurgeryCaseView['events'][number]['kind'],
) {
  return c.events.some((e) => e.kind === kind);
}

export function confirmed(c: Pick<SurgeryCaseView, 'checklist'>, phase: ChecklistPhaseId): boolean {
  return !!c.checklist.find((p) => p.phase === phase)?.confirmedAt;
}

/** Peristiwa berikutnya yang boleh dicatat (urutan induksi → insisi → tutup → keluar). */
export function nextEvent(c: SurgeryCaseView): SurgeryCaseView['events'][number]['kind'] | null {
  if (c.status === 'batal' || c.status === 'selesai') return null;
  if (!hasEvent(c, 'induksi')) return 'induksi';
  if (!hasEvent(c, 'insisi')) return 'insisi';
  if (!hasEvent(c, 'tutup')) return 'tutup';
  if (!hasEvent(c, 'keluar')) return 'keluar';
  return null;
}

/**
 * Alasan peristiwa berikutnya belum bisa dicatat (petunjuk layar; server menegakkan ulang): induksi butuh sign in,
 * insisi butuh time out (kecuali override dokter), keluar butuh sign out.
 */
export function eventBlock(c: SurgeryCaseView): string | null {
  const next = nextEvent(c);
  if (next === 'induksi' && !confirmed(c, 'sign-in')) return 'Induksi terkunci sampai sign in dikonfirmasi.';
  if (next === 'insisi' && !confirmed(c, 'time-out')) {
    const left = manualRemaining(c, 'time-out');
    return left
      ? `Time out belum lengkap (${left} butir tersisa). Insisi terkunci sampai time out dikonfirmasi.`
      : 'Time out lengkap tetapi belum dikonfirmasi. Konfirmasi time out untuk membuka insisi.';
  }
  if (next === 'keluar' && !confirmed(c, 'sign-out'))
    return 'Pasien keluar kamar setelah sign out dikonfirmasi.';
  return null;
}

/**
 * Syarat sign in di luar butir manual (4.7/4.7b; server menegakkan ulang): persetujuan tindakan final yang berlaku dan
 * asesmen pra-anestesi final. Kosong = boleh dikonfirmasi bila butir lengkap.
 */
export function signInBlockers(c: Pick<SurgeryCaseView, 'consent' | 'anesthesia'>): string[] {
  return [
    ...(c.consent ? [] : ['Persetujuan tindakan bertanda tangan belum ada.']),
    ...(c.anesthesia.preAssessment ? [] : ['Asesmen pra-anestesi final belum ada.']),
  ];
}

/** Jam WIB `HH:MM` + tanggal → ISO dengan zona WIB. */
export function wibInstant(date: string, hhmm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3])[:.][0-5]\d$/.test(hhmm)) return null;
  return new Date(`${date}T${hhmm.replace('.', ':')}:00+07:00`).toISOString();
}
