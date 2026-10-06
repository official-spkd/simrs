import 'server-only';
import { demoSatusehatVisits } from '../../demo/fixtures/integrasi-satusehat';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import type { Visit } from '../../integrasi-satusehat';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * I02–I04, I06, I12 · Pintu data layar konektor integrasi (SATUSEHAT, BPJS, Kemenkes, perangkat medis, API publik).
 * Mode presentasi: data dummy fiktif (ADR-0023); mode api menunggu backend fase 7. Server Action mencari rekaman
 * lewat fixture yang sama (klien hanya mengirim id).
 */

const isDemo = () => {
  if (webEnv().dataSource !== 'demo') return false;
  assertDemo();
  return true;
};

export async function getSatusehatVisits(): Promise<{ asOf: string; visits: Visit[] }> {
  if (!isDemo()) return notImplemented('konektor SATUSEHAT');
  return { asOf: DEMO_NOW, visits: demoSatusehatVisits() };
}
