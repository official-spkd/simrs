import { describe, expect, it } from 'vitest';
import { activeNavId, NAV_GROUPS, navGroups, SUPERADMIN_GROUP } from './nav';
import { SCREENS } from './screens';

describe('activeNavId', () => {
  it('beranda hanya cocok dengan "/" persis', () => {
    expect(activeNavId('/')).toBe('beranda');
    expect(activeNavId('/tidak-ada')).toBeUndefined();
  });

  it('cocokkan prefix rute bertingkat', () => {
    expect(activeNavId('/klinis/rawat-inap/0199a1b2-0000-7000-8000-000000000001')).toBe('ranap');
    expect(activeNavId('/dev/ui')).toBe('devui');
    expect(activeNavId('/superadmin/panduan/tutorial')).toBe('panduan');
  });

  it('setiap id menu unik', () => {
    const ids = [...NAV_GROUPS, SUPERADMIN_GROUP].flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('navGroups', () => {
  const ids = (groups: ReturnType<typeof navGroups>) => groups.flatMap((g) => g.items.map((i) => i.id));
  const base = { kind: 'hospital' as const, superadmin: false, dataSource: 'api' as const, role: 'perawat' };

  it('menu berizin hanya tampil bila peran memegang izinnya', () => {
    const perawat = navGroups({ ...base, permissions: ['patient.read'] });
    expect(ids(perawat)).not.toContain('akses');
    expect(ids(perawat)).toContain('igd');
    const admin = navGroups({ ...base, role: 'admin_tenant', permissions: ['iam.users.read'] });
    expect(ids(admin)).toContain('akses');
  });

  it('grup superadmin hanya untuk superadmin; tenant PLATFORM tanpa menu klinis', () => {
    expect(navGroups({ ...base, permissions: [] }).map((g) => g.title)).not.toContain('SUPERADMIN');
    const platform = navGroups({
      ...base,
      kind: 'platform',
      superadmin: true,
      role: 'superadmin_platform',
      permissions: ['iam.users.read'],
    });
    expect(platform.at(-1)?.title).toBe('SUPERADMIN');
    expect(ids(platform)).toEqual(['beranda', 'akses', 'panduan', 'devui']);
  });

  it('layar yang belum dibangun tetap redup di mode api maupun demo', () => {
    for (const dataSource of ['api', 'demo'] as const) {
      const items = navGroups({ ...base, dataSource, permissions: [] }).flatMap((g) => g.items);
      const belum = SCREENS.filter((s) => s.status === 'belum').map((s) => s.id);
      for (const item of items.filter((i) => belum.includes(i.id))) expect(item.available).toBe(false);
    }
  });

  it('layar data dummy: redup di mode api, terbuka di mode presentasi untuk posisi pemakainya', () => {
    const find = (groups: ReturnType<typeof navGroups>) =>
      groups.flatMap((g) => g.items).find((i) => i.id === 'simulasi');
    expect(find(navGroups({ ...base, permissions: [] }))?.available).toBe(false);
    expect(find(navGroups({ ...base, dataSource: 'demo', permissions: [] }))?.available).toBe(true);
  });

  it('layar hibrida front office di mode api mengikuti izin sungguhan; di mode presentasi mengikuti posisi', () => {
    const item = (groups: ReturnType<typeof navGroups>, id: string) =>
      groups.flatMap((g) => g.items).find((i) => i.id === id);
    const pendaftaran = { ...base, role: 'petugas_pendaftaran' };
    // Tanpa izin: tidak tampil sama sekali (seperti menu ber-`requires`), bukan redup.
    expect(item(navGroups({ ...pendaftaran, permissions: [] }), 'daftar')).toBeUndefined();
    expect(item(navGroups({ ...pendaftaran, permissions: [] }), 'jadwal')).toBeUndefined();
    const granted = navGroups({ ...pendaftaran, permissions: ['encounter.write', 'schedule.read'] });
    expect(item(granted, 'daftar')?.available).toBe(true);
    expect(item(granted, 'jadwal')?.available).toBe(true);
    expect(item(granted, 'antrean')).toBeUndefined();
    // Mode presentasi: izin tidak berperan, posisi pemakai layar yang menentukan.
    const demo = navGroups({ ...pendaftaran, dataSource: 'demo', permissions: [] });
    expect(item(demo, 'daftar')?.available).toBe(true);
    expect(item(navGroups({ ...base, dataSource: 'demo', permissions: ['encounter.write'] }), 'daftar')).toBe(
      undefined,
    );
  });

  it('setiap menu layar fase 2–10 terdaftar di registri SCREENS dengan rute yang sama', () => {
    const screenIds = new Set(SCREENS.map((s) => s.id));
    for (const item of NAV_GROUPS.flatMap((g) => g.items).filter((i) => screenIds.has(i.id))) {
      expect(SCREENS.find((s) => s.id === item.id)?.route).toBe(item.href);
    }
  });
});
