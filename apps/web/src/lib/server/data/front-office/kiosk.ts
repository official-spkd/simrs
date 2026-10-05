import 'server-only';
import { type RegistrationPatient, registrationPatientSchema } from '@simrs/shared';
import { DEFAULT_PATIENT_ID, registrationPatients } from '../../../demo/fixtures/front-office';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/** F05 · Data anjungan mandiri. Mode presentasi: data dummy; mode api: menunggu fase 2 potongan 6. */

/** Pasien anjungan di luar skenario (Ny. Siti Rahmawati). */
export async function getKioskDefaultPatient(): Promise<RegistrationPatient> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const p = registrationPatients().find((x) => x.id === DEFAULT_PATIENT_ID);
    if (!p) throw new Error('Pasien bawaan anjungan tidak ada di fixture');
    return registrationPatientSchema.parse(p);
  }
  return notImplemented('anjungan');
}
