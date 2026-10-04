import 'server-only';
import {
  type QueueBoard,
  queueBoardSchema,
  type RegistrationDesk,
  registrationDeskSchema,
  type RegistrationPatient,
  registrationPatientSchema,
  type WeeklySchedule,
  weeklyScheduleSchema,
} from '@simrs/shared';
import { z } from 'zod';
import {
  DEFAULT_PATIENT_ID,
  demoQueueBoard,
  demoRegistrationDesk,
  demoWeeklySchedule,
  type FrontOfficeProgress,
  registrationPatients,
  scenarioRegistrationPatient,
} from '../../demo/fixtures/front-office';
import { redirect } from 'next/navigation';
import { frontOfficeProgress } from '../../front-office';
import { screenById, screenOpen } from '../../screens';
import { nextLoginStep, type SessionView } from '../../session-view';
import { scenarioRuns } from '../demo/scenario-context';
import { assertDemo } from '../demo-guard';
import { getSession } from '../session';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * F01–F06 · Data front office. Satu-satunya pintu halaman jadwal, pendaftaran, anjungan, dan papan antrean: mode
 * presentasi memakai data dummy (divalidasi kontrak yang sama dengan API kelak) yang memproyeksikan kemajuan
 * Tn. Suryo (skenario rawat jalan); mode api menunggu backend fase 2.
 */

/**
 * Gerbang Server Action front office (endpoint POST publik): mode presentasi, sesi lengkap (pola
 * `simulasi/actions.ts`), dan posisi yang memakai layar `screenId`. Tidak menyimpan apa pun.
 */
export async function frontOfficeActionSession(screenId: string): Promise<SessionView | null> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  if (!screen || !screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null })) return null;
  return s;
}

async function demoProgress(session: SessionView): Promise<FrontOfficeProgress> {
  assertDemo();
  const runs = await scenarioRuns(session);
  return frontOfficeProgress(runs.results['rawat-jalan']);
}

export async function getWeeklySchedule(session: SessionView): Promise<WeeklySchedule> {
  if (webEnv().dataSource === 'demo') {
    return weeklyScheduleSchema.parse(demoWeeklySchedule(await demoProgress(session)));
  }
  return notImplemented('jadwal dokter');
}

export async function getQueueBoard(session: SessionView): Promise<QueueBoard> {
  if (webEnv().dataSource === 'demo') {
    return queueBoardSchema.parse(demoQueueBoard(await demoProgress(session)));
  }
  return notImplemented('papan antrean');
}

export async function getRegistrationDesk(session: SessionView): Promise<RegistrationDesk> {
  if (webEnv().dataSource === 'demo') {
    return registrationDeskSchema.parse(demoRegistrationDesk(await demoProgress(session)));
  }
  return notImplemented('pendaftaran');
}

/**
 * Mode presentasi: pasien dummy yang bisa dicari di meja pendaftaran (di luar skenario). Bukan bagian kontrak meja:
 * mode api mencari pasien satu per satu lewat MPI (berizin, diaudit), tidak memuat daftar di depan.
 */
export async function getDemoDeskPatients(): Promise<RegistrationPatient[]> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return z.array(registrationPatientSchema).parse(registrationPatients());
  }
  return notImplemented('pendaftaran');
}

/** Pasien skenario rawat jalan (Tn. Suryo) untuk meja pendaftaran dan anjungan. */
export async function getScenarioRegistrationPatient(): Promise<RegistrationPatient> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return registrationPatientSchema.parse(scenarioRegistrationPatient());
  }
  return notImplemented('pendaftaran');
}

/** Pasien anjungan di luar skenario (Siti Rahmawati). */
export async function getKioskDefaultPatient(): Promise<RegistrationPatient> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const p = registrationPatients().find((x) => x.id === DEFAULT_PATIENT_ID);
    if (!p) throw new Error('Pasien bawaan anjungan tidak ada di fixture');
    return registrationPatientSchema.parse(p);
  }
  return notImplemented('anjungan');
}
