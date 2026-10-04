import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { screenById } from '../screens';
import { firstOpenTask } from './engine/run';
import type { RunResult } from './engine/types';

/** Ringkasan langkah aktif untuk panel panduan presenter (melayang di layar staf saat mode presentasi). */
export interface GuideView {
  scenarioLabel: string;
  patientName: string;
  stepNo: string;
  stage: string;
  title: string;
  actor: string;
  role: SystemRoleCode | null;
  roleName: string | null;
  screen: { id: string; label: string; route: string; ready: boolean } | null;
  /** Tugas terbuka berikutnya (null bila langkah sudah lengkap: tinggal lanjut). */
  nextTask: string | null;
  finished: boolean;
  /** Posisi aktif sudah sesuai dengan pembawa langkah ini. */
  onRole: boolean;
}

export function guideView(R: RunResult, currentRole: string | null): GuideView {
  const N = R.def.steps.length;
  const s = R.def.steps[Math.min(R.step, N - 1)];
  const screen = s ? screenById(s.screen) : undefined;
  const open = R.finished ? null : firstOpenTask(R, R.step);
  return {
    scenarioLabel: R.def.label,
    patientName: R.rec.nama,
    stepNo: R.finished ? `${N} dari ${N}` : `${R.step + 1} dari ${N}`,
    stage: R.finished ? 'Selesai' : (s?.stage ?? ''),
    title: R.finished ? 'Simulasi selesai, lihat ringkasan.' : (s?.title ?? ''),
    actor: s?.actor ?? '',
    role: s?.role ?? null,
    roleName: s?.role ? SYSTEM_ROLES[s.role] : null,
    screen: screen
      ? { id: screen.id, label: screen.label, route: screen.route, ready: screen.status !== 'belum' }
      : null,
    nextTask: R.finished ? null : (open?.label ?? null),
    finished: R.finished,
    onRole: !s?.role || s.role === currentRole,
  };
}
