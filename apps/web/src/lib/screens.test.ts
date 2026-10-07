import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLE_GRANTS,
  isPermission,
  isPermissionKey,
  SYSTEM_ROLES,
  type SystemRoleCode,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  CLINICAL_PERMISSIONS,
  FRONT_OFFICE_PERMISSIONS,
  type ScreenDef,
  SCREENS,
  screenById,
  actingRoleFor,
  actingRoleOptions,
  screenForPath,
  screenOpen,
  SUPPORT_PERMISSIONS,
} from './screens';

describe('posisi yang dibawakan Superadmin demo (ADR-0023 keputusan 10)', () => {
  it('screenForPath: awalan rute terpanjang, query diabaikan, di luar registri undefined', () => {
    expect(screenForPath('/klinis/rawat-inap/0199a1b2-0000-7000-8000-000000000001?tab=cppt')?.id).toBe(
      'ranap',
    );
    expect(screenForPath('/sistem/integrasi/satusehat')?.id).toBe('satusehat');
    expect(screenForPath('/sistem/integrasi')?.id).toBe('integrasi');
    expect(screenForPath('/klinis/order-lain')).toBeUndefined();
    expect(screenForPath('/')).toBeUndefined();
    expect(screenForPath('/superadmin/panduan')).toBeUndefined();
  });

  it('actingRoleFor: pilihan presenter bila layar memakainya, selain itu pemakai pertama layar', () => {
    const ranap = screenById('ranap');
    const kasir = screenById('kasir');
    const simulasi = screenById('simulasi');
    expect(actingRoleOptions(ranap)).toEqual(['dokter', 'dokter_residen', 'perawat', 'bidan']);
    expect(actingRoleFor(ranap, null, 'manajemen')).toBe('dokter');
    expect(actingRoleFor(ranap, 'perawat', 'manajemen')).toBe('perawat');
    expect(actingRoleFor(kasir, 'perawat', 'manajemen')).toBe('kasir');
    // Layar untuk semua posisi dan halaman di luar registri: pilihan presenter atau peran asli.
    expect(actingRoleOptions(simulasi)).toEqual([]);
    expect(actingRoleFor(simulasi, null, 'manajemen')).toBe('manajemen');
    expect(actingRoleFor(undefined, 'kasir', 'manajemen')).toBe('kasir');
  });

  it('setiap layar registri terbuka untuk posisi yang dibawakan di rutenya (tanpa tanda pun)', () => {
    for (const s of SCREENS.filter((x) => x.status !== 'belum' && !x.apiOnly)) {
      const role = actingRoleFor(screenForPath(s.route), null, 'manajemen');
      expect(screenOpen(s, { dataSource: 'demo', role }), s.id).toBe(true);
    }
  });
});

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
    for (const key of SUPPORT_PERMISSIONS) expect(isPermissionKey(key), key).toBe(true);
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

  it('Superadmin demo (allAccess): semua layar di mode presentasi; di mode api tidak ada layar tambahan', () => {
    const demoOnly = screen({});
    const hybrid = screen({ permission: 'schedule.read' });
    const opts = { role: 'manajemen', allAccess: true } as const;
    expect(screenOpen(demoOnly, { ...opts, dataSource: 'demo' })).toBe(true);
    expect(screenOpen(hybrid, { ...opts, dataSource: 'demo' })).toBe(true);
    // Tetap tertutup: belum dibangun dan layar khusus api.
    expect(screenOpen(screen({ status: 'belum' }), { ...opts, dataSource: 'demo' })).toBe(false);
    expect(screenOpen(screen({ status: 'api', apiOnly: true }), { ...opts, dataSource: 'demo' })).toBe(false);
    // Mode api: tanda diabaikan, hasilnya sama dengan tanpa tanda untuk SETIAP layar registri.
    for (const s of SCREENS) {
      for (const permissions of [[], ['schedule.read', 'bed.read'], ['clinical.write']]) {
        expect(
          screenOpen(s, { dataSource: 'api', role: 'manajemen', permissions, allAccess: true }),
          s.id,
        ).toBe(screenOpen(s, { dataSource: 'api', role: 'manajemen', permissions }));
      }
    }
    expect(screenOpen(demoOnly, { ...opts, dataSource: 'api', permissions: [] })).toBe(false);
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
      konsul: 'clinical.write',
      edukasi: 'clinical.write',
      paket: 'forms.definition.read',
      worklist: 'clinical.read',
      cppt: 'clinical.write',
      asesmen: 'clinical.write',
      diagnosis: 'clinical.write',
      askep: 'clinical.write',
      ringkasan: 'clinical.read',
      kelengkapan: 'clinical.read',
      lab: 'lab.worklist.read',
      rad: 'radiology.read',
      farmasi: 'pharmacy.review.read',
      ok: 'surgery.read',
      kritis: 'critical_result.read',
      depo: 'stock.read',
      'bank-darah': 'blood_bank.read',
      gizi: 'nutrition.read',
      mikro: 'lab.worklist.read',
      diagnostik: 'diagnostics.write',
    });
    const known: readonly string[] = [
      ...FRONT_OFFICE_PERMISSIONS,
      ...CLINICAL_PERMISSIONS,
      ...SUPPORT_PERMISSIONS,
    ];
    for (const s of SCREENS) {
      if (s.permission) {
        expect(known, s.id).toContain(s.permission);
        expect(s.plannedPermission, s.id).toBe(s.permission);
        expect(s.phase >= 2 && s.phase <= 4, s.id).toBe(true);
      }
    }
  });

  it('layar penunjang hibrida (4.0c): izin layar dipegang peran pelaksananya di matriks bawaan 4.0a', () => {
    const holds = (role: SystemRoleCode, key: string) =>
      DEFAULT_ROLE_GRANTS[role].some(([resource, action]) => `${resource}.${action}` === key);
    const performer: Record<string, SystemRoleCode> = {
      lab: 'analis_lab',
      rad: 'radiografer',
      farmasi: 'apoteker',
      ok: 'perawat',
      kritis: 'perawat',
      depo: 'apoteker',
      'bank-darah': 'analis_lab',
      gizi: 'ahli_gizi',
      mikro: 'analis_lab',
      diagnostik: 'dokter',
    };
    for (const [id, role] of Object.entries(performer)) {
      const s = screenById(id);
      expect(s?.permission, id).toBeDefined();
      expect(holds(role, s?.permission ?? ''), `${id}: ${role}`).toBe(true);
      expect(screenOpen(s!, { dataSource: 'api', role: 'kasir', permissions: [] }), id).toBe(false);
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
