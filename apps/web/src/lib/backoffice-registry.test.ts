import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from './nav';
import { SCREENS } from './screens';

/** FE5 · setiap layar back office/kanal fase 8–9 terdaftar di registri DAN punya menu dengan rute yang sama. */
const FE5_SCREENS = [
  'rm-adm',
  'sdm',
  'kredensial',
  'ppi',
  'aset',
  'penggajian',
  'ppra',
  'dokumen',
  'pengaduan',
] as const;

describe('registri layar FE5', () => {
  const items = NAV_GROUPS.flatMap((g) => g.items);
  for (const id of FE5_SCREENS) {
    it(`${id}: status demo, fase 8–9, punya menu`, () => {
      const s = SCREENS.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect(s?.status).toBe('demo');
      expect([8, 9]).toContain(s?.phase);
      expect(s?.components.length).toBeGreaterThan(0);
      expect(items.find((i) => i.id === id)?.href, id).toBe(s?.route);
    });
  }
});
