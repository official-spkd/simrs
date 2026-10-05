import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPermission, isPermissionKey, SYSTEM_ROLES } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  CLINICAL_PERMISSIONS,
  FRONT_OFFICE_PERMISSIONS,
  type ScreenDef,
  SCREENS,
  screenById,
  screenOpen,
} from './screens';

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

  it('izin rencana layar fase 2 dan izin layar hibrida ada di katalog izin (fase 2 §0a, fase 3 §3.0a)', () => {
    const phase2 = SCREENS.filter((s) => s.phase === 2);
    expect(phase2.length).toBeGreaterThan(0);
    for (const s of phase2) {
      const dot = s.plannedPermission.lastIndexOf('.');
      const [resource, action] = [s.plannedPermission.slice(0, dot), s.plannedPermission.slice(dot + 1)];
      expect(isPermission(resource, action), `${s.id}: ${s.plannedPermission}`).toBe(true);
    }
    for (const key of FRONT_OFFICE_PERMISSIONS) expect(isPermissionKey(key), key).toBe(true);
    for (const key of CLINICAL_PERMISSIONS) expect(isPermissionKey(key), key).toBe(true);
    // Layar hibrida fase 3: izin layar juga kunci katalog (potongan 3.0a).
    for (const s of SCREENS.filter((x) => x.permission))
      expect(isPermissionKey(s.permission ?? ''), s.id).toBe(true);
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

  it('hibrida (ber-izin): mode presentasi menurut posisi, mode api menurut izin sungguhan', () => {
    const s = screen({ permission: 'schedule.read' });
    expect(screenOpen(s, { dataSource: 'demo', role: 'kasir', permissions: [] })).toBe(true);
    expect(screenOpen(s, { dataSource: 'demo', role: 'perawat', permissions: ['schedule.read'] })).toBe(
      false,
    );
    expect(screenOpen(s, { dataSource: 'api', role: 'perawat', permissions: ['schedule.read'] })).toBe(true);
    expect(screenOpen(s, { dataSource: 'api', role: 'kasir', permissions: ['patient.read'] })).toBe(false);
    expect(screenOpen(s, { dataSource: 'api', role: 'kasir' })).toBe(false);
    // Setelah tersambung (status `api`), jalur demo tetap hidup dan izin tetap berlaku di mode api.
    const live = screen({ status: 'api', permission: 'schedule.read' });
    expect(screenOpen(live, { dataSource: 'demo', role: 'kasir' })).toBe(true);
    expect(screenOpen(live, { dataSource: 'api', role: 'kasir', permissions: [] })).toBe(false);
    expect(
      screenOpen(screen({ status: 'belum', permission: 'schedule.read' }), {
        dataSource: 'api',
        role: 'kasir',
        permissions: ['schedule.read'],
      }),
    ).toBe(false);
  });
});

describe('izin layar front office (rencana fase 2 · 0c, 4b)', () => {
  it('Kendali antrean (staf, `queue.read`) hanya mode api; display TV tetap izin perangkat', () => {
    const kendali = screenById('kendali');
    if (!kendali) throw new Error('kendali');
    expect(kendali).toMatchObject({ route: '/antrean', status: 'api', apiOnly: true, layout: 'staf' });
    expect(screenOpen(kendali, { dataSource: 'demo', role: 'petugas_pendaftaran', permissions: [] })).toBe(
      false,
    );
    expect(screenOpen(kendali, { dataSource: 'api', role: 'perawat', permissions: ['queue.read'] })).toBe(
      true,
    );
    expect(screenOpen(kendali, { dataSource: 'api', role: 'kasir', permissions: [] })).toBe(false);
  });

  it('layar ber-izin: front office fase 2 dan klinis fase 3; layar lain belum punya jalur api', () => {
    const map = Object.fromEntries(SCREENS.filter((s) => s.permission).map((s) => [s.id, s.permission]));
    expect(map).toEqual({
      daftar: 'encounter.write',
      jadwal: 'schedule.read',
      kiosk: 'kiosk.use',
      antrean: 'queue.display.read',
      kendali: 'queue.read',
      poli: 'clinical.write',
      order: 'order.write',
      igd: 'clinical.read',
      bed: 'bed.read',
      ranap: 'clinical.write',
      resume: 'clinical.write',
      consent: 'consent.write',
    });
    const known: readonly string[] = [...FRONT_OFFICE_PERMISSIONS, ...CLINICAL_PERMISSIONS];
    for (const s of SCREENS) {
      if (s.permission) {
        expect(known, s.id).toContain(s.permission);
        expect(s.plannedPermission, s.id).toBe(s.permission);
        expect(s.phase === 2 || s.phase === 3, s.id).toBe(true);
      }
    }
  });

  it('layar klinis hibrida: terbuka di mode api hanya bagi peran yang memegang izinnya', () => {
    const ranap = screenById('ranap');
    if (!ranap) throw new Error('layar ranap tidak ada');
    expect(screenOpen(ranap, { dataSource: 'demo', role: 'perawat', permissions: [] })).toBe(true);
    expect(screenOpen(ranap, { dataSource: 'demo', role: 'kasir', permissions: ['clinical.write'] })).toBe(
      false,
    );
    expect(screenOpen(ranap, { dataSource: 'api', role: 'perawat', permissions: ['clinical.write'] })).toBe(
      true,
    );
    expect(screenOpen(ranap, { dataSource: 'api', role: 'perawat', permissions: ['patient.read'] })).toBe(
      false,
    );
  });
});
