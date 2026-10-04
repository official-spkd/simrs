import 'server-only';
import {
  type RegistrationDesk,
  registrationDeskSchema,
  type RegistrationPatient,
  registrationPatientSchema,
} from '@simrs/shared';
import { demoRegistrationDesk, scenarioRegistrationPatient } from '../../../demo/fixtures/front-office';
import type { SessionView } from '../../../session-view';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';
import { demoProgress } from './shared';

/** F03/F06 · Data meja pendaftaran. Mode presentasi: data dummy; mode api: menunggu fase 2 potongan 5b. */

export async function getRegistrationDesk(session: SessionView): Promise<RegistrationDesk> {
  if (webEnv().dataSource === 'demo') {
    return registrationDeskSchema.parse(demoRegistrationDesk(await demoProgress(session)));
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
