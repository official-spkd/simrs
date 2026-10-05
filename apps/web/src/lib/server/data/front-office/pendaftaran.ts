import 'server-only';
import {
  type BpjsQueueTask,
  bpjsQueueTaskSchema,
  type PrintableVisit,
  printableVisitSchema,
  type QueueService,
  queueServiceSchema,
  type RegistrationDesk,
  registrationDeskSchema,
  type RegistrationPatient,
  registrationPatientSchema,
  type RegistrationResult,
  registrationResultSchema,
} from '@simrs/shared';
import { z } from 'zod';
import {
  demoRegistrationDesk,
  registrationPatients,
  scenarioRegistrationPatient,
} from '../../../demo/fixtures/front-office';
import type { SessionView } from '../../../session-view';
import { api } from '../../api';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { demoProgress } from './shared';

/**
 * F03/F06 · Data meja pendaftaran. Mode presentasi: data dummy; mode api (fase 2 potongan 5b): meja, layanan loket,
 * hasil registrasi, task ID BPJS, dan lembar cetak dari API (izin ditegakkan API, baca diaudit per pasien).
 */

export async function getRegistrationDesk(session: SessionView): Promise<RegistrationDesk> {
  if (webEnv().dataSource === 'demo') {
    return registrationDeskSchema.parse(demoRegistrationDesk(await demoProgress(session)));
  }
  return notImplemented('pendaftaran (pakai getRegistrationDeskApi)');
}

/** Mode api: antrean loket admisi + kuota dokter hari ini (`encounter.write`). */
export function getRegistrationDeskApi(): Promise<RegistrationDesk> {
  return api('/api/v1/registration/desk', { schema: registrationDeskSchema });
}

/** Mode api: layanan loket pendaftaran aktif (untuk "Panggil berikutnya"); null bila belum ada atau tanpa izin. */
export async function getCounterServiceApi(): Promise<QueueService | null> {
  const list = await api('/api/v1/queue/services', { schema: z.array(queueServiceSchema) });
  return list.find((s) => s.kind === 'loket' && s.active) ?? null;
}

/** Mode api: kunjungan + penjaminan + SEP terbaru + tiket poli (`id` sudah divalidasi UUID oleh pemanggil). */
export function getRegistrationResultApi(encounterId: string): Promise<RegistrationResult> {
  return api(`/api/v1/registration/encounters/${encounterId}`, { schema: registrationResultSchema });
}

/** Mode api: status task ID Antrean BPJS satu booking (chip task 1–3). */
export function getBpjsTasksApi(appointmentId: string): Promise<BpjsQueueTask[]> {
  return api(`/api/v1/queue/bpjs-tasks?appointmentId=${appointmentId}`, {
    schema: z.array(bpjsQueueTaskSchema),
  });
}

/** Mode api: lembar cetak loket (tiket poli + ringkasan SEP); API mencatat audit `print`. */
export function getPrintableVisitApi(encounterId: string): Promise<PrintableVisit> {
  return api(`/api/v1/registration/encounters/${encounterId}/print`, { schema: printableVisitSchema });
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
