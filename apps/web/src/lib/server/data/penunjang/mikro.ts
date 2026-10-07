import 'server-only';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import type { CultureCase, PaCase } from '../../../penunjang-mikro';
import { readDomain } from '../../demo/state';
import { notImplemented } from '../not-implemented';
import { isDemoData } from './shared';

/** S02 · Data layar Mikrobiologi dan PA. Mode presentasi: dummy + toko demo `penunjang`; mode api diisi 4.8. */

export interface MicroData {
  rev: number;
  asOf: string;
  cultures: CultureCase[];
  pa: PaCase[];
}

export async function getMicroPa(): Promise<MicroData> {
  if (!isDemoData()) return notImplemented('mikrobiologi dan patologi anatomi');
  const { state, rev } = await readDomain('penunjang');
  return { asOf: DEMO_NOW, cultures: state.cultures, pa: state.pa, rev };
}
