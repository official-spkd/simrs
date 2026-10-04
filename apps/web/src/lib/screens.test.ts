import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SYSTEM_ROLES } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { type ScreenDef, SCREENS, screenById, screenOpen } from './screens';

const mockupDir = fileURLToPath(new URL('../../../../design/mockups/', import.meta.url));

describe('registri layar (ADR-0023)', () => {
  it('id dan rute unik; rute absolut; mockup acuan benar-benar ada', () => {
    expect(new Set(SCREENS.map((s) => s.id)).size).toBe(SCREENS.length);
    expect(new Set(SCREENS.map((s) => s.route)).size).toBe(SCREENS.length);
    for (const s of SCREENS) {
      expect(s.route).toMatch(/^\/[a-z0-9/-]+$/);
      if (s.mockup) expect(existsSync(`${mockupDir}${s.mockup}.dc.html`), s.mockup).toBe(true);
    }
  });

  it('peran demo hanya peran sistem yang dikenal', () => {
    for (const s of SCREENS) {
      if (s.demoRoles === 'semua') continue;
      expect(s.demoRoles.length).toBeGreaterThan(0);
      for (const r of s.demoRoles) expect(Object.keys(SYSTEM_ROLES)).toContain(r);
    }
  });

  it('screenById', () => {
    expect(screenById('dasbor')?.route).toBe('/manajemen/dasbor');
    expect(screenById('tidak-ada')).toBeUndefined();
  });
});

describe('screenOpen', () => {
  const screen = (patch: Partial<ScreenDef>): ScreenDef => ({
    id: 'x',
    label: 'X',
    route: '/x',
    mockup: null,
    components: [],
    phase: 2,
    status: 'demo',
    plannedPermission: 'x.read',
    demoRoles: ['kasir'],
    layout: 'staf',
    ...patch,
  });

  it('belum dibangun: tertutup di mode mana pun', () => {
    const s = screen({ status: 'belum' });
    expect(screenOpen(s, { dataSource: 'demo', role: 'kasir' })).toBe(false);
    expect(screenOpen(s, { dataSource: 'api', role: 'kasir' })).toBe(false);
  });

  it('data dummy: hanya di mode presentasi, untuk posisi pemakainya', () => {
    const s = screen({});
    expect(screenOpen(s, { dataSource: 'demo', role: 'kasir' })).toBe(true);
    expect(screenOpen(s, { dataSource: 'demo', role: 'perawat' })).toBe(false);
    expect(screenOpen(s, { dataSource: 'demo', role: null })).toBe(false);
    expect(screenOpen(s, { dataSource: 'api', role: 'kasir' })).toBe(false);
    expect(screenOpen(screen({ demoRoles: 'semua' }), { dataSource: 'demo', role: null })).toBe(true);
  });

  it('tersambung API: terbuka di semua lingkungan (izin ditegakkan API)', () => {
    expect(screenOpen(screen({ status: 'api' }), { dataSource: 'api', role: 'perawat' })).toBe(true);
  });
});
