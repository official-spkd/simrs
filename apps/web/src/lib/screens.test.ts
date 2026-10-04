import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPermission, SYSTEM_ROLES } from '@simrs/shared';
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

  it('layar fase 2: izin rencana sudah ada di katalog izin (rencana fase 2 §0a)', () => {
    const phase2 = SCREENS.filter((s) => s.phase === 2);
    expect(phase2.length).toBeGreaterThan(0);
    for (const s of phase2) {
      const dot = s.plannedPermission.lastIndexOf('.');
      const [resource, action] = [s.plannedPermission.slice(0, dot), s.plannedPermission.slice(dot + 1)];
      expect(isPermission(resource, action), `${s.id}: ${s.plannedPermission}`).toBe(true);
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
