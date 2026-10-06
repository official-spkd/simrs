import { describe, expect, it } from 'vitest';
import { activeNavId, ALL_ACCESS_NAV, NAV_GROUPS, navGroups, SUPERADMIN_GROUP } from './nav';
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
    expect(ids(perawat)).toContain('lab');
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

  it('layar hibrida klinis di mode api mengikuti izin sungguhan (fase 3 potongan 3.0d)', () => {
    const item = (groups: ReturnType<typeof navGroups>, id: string) =>
      groups.flatMap((g) => g.items).find((i) => i.id === id);
    const none = navGroups({ ...base, permissions: [] });
    for (const id of ['poli', 'igd', 'ranap', 'bed']) expect(item(none, id), id).toBeUndefined();
    const perawat = navGroups({ ...base, permissions: ['clinical.read', 'clinical.write', 'bed.read'] });
    for (const id of ['poli', 'igd', 'ranap', 'bed']) expect(item(perawat, id)?.available, id).toBe(true);
    // Petugas pendaftaran (admisi IGD): papan IGD dan tempat tidur, tanpa layar pemeriksaan/rawat inap.
    const admisi = navGroups({
      ...base,
      role: 'petugas_pendaftaran',
      permissions: ['clinical.read', 'triage.write', 'bed.read', 'bed.write'],
    });
    expect(item(admisi, 'igd')?.available).toBe(true);
    expect(item(admisi, 'bed')?.available).toBe(true);
    expect(item(admisi, 'poli')).toBeUndefined();
    expect(item(admisi, 'ranap')).toBeUndefined();
    const manajemen = navGroups({ ...base, role: 'manajemen', permissions: ['bed.read'] });
    expect(item(manajemen, 'bed')?.available).toBe(true);
    expect(item(manajemen, 'ranap')).toBeUndefined();
  });

  it('menu antrean staf = Kendali antrean (`queue.read`, mode api); display TV hanya di mode presentasi', () => {
    const item = (groups: ReturnType<typeof navGroups>, id: string) =>
      groups.flatMap((g) => g.items).find((i) => i.id === id);
    const api = navGroups({ ...base, permissions: ['queue.read'] });
    expect(item(api, 'kendali')).toMatchObject({ href: '/antrean', available: true });
    expect(item(api, 'antrean')).toBeUndefined();
    expect(item(navGroups({ ...base, permissions: [] }), 'kendali')).toBeUndefined();
    const demo = navGroups({
      ...base,
      role: 'petugas_pendaftaran',
      dataSource: 'demo',
      permissions: ['queue.read'],
    });
    expect(item(demo, 'kendali')).toBeUndefined();
    expect(item(demo, 'antrean')?.href).toBe('/display/antrean');
  });

  it('setiap menu layar fase 2–10 terdaftar di registri SCREENS dengan rute yang sama', () => {
    const screenIds = new Set(SCREENS.map((s) => s.id));
    for (const item of [...NAV_GROUPS, ...ALL_ACCESS_NAV]
      .flatMap((g) => g.items)
      .filter((i) => screenIds.has(i.id))) {
      expect(SCREENS.find((s) => s.id === item.id)?.route).toBe(item.href);
    }
  });
});

describe('navGroups · Superadmin demo (ADR-0023 keputusan 10)', () => {
  const ids = (groups: ReturnType<typeof navGroups>) => groups.flatMap((g) => g.items.map((i) => i.id));
  const manajemen = {
    kind: 'hospital' as const,
    superadmin: false,
    role: 'manajemen',
    permissions: ['audit.read', 'schedule.read', 'bed.read', 'tenant.settings.read', 'facility.read'],
  };
  const reachable = SCREENS.filter((s) => s.status !== 'belum' && !s.apiOnly);

  it('mode presentasi: setiap layar registri (kecuali khusus api) tampil terbuka, sekali saja, plus panduan', () => {
    const groups = navGroups({ ...manajemen, dataSource: 'demo', allAccess: true });
    const all = ids(groups);
    expect(new Set(all).size).toBe(all.length);
    for (const s of reachable) {
      const item = groups.flatMap((g) => g.items).find((i) => i.id === s.id);
      expect(item, s.id).toMatchObject({ href: s.route, available: true });
    }
    expect(all).not.toContain('kendali');
    expect(all).toContain('panduan');
    expect(groups.map((g) => g.title)).toEqual([
      'UMUM',
      'FRONT OFFICE',
      'KLINIS',
      'PENUNJANG',
      'KEUANGAN',
      'MANAJEMEN',
      'BACK OFFICE',
      'PERANGKAT & PRATINJAU',
      'SISTEM',
      'PANDUAN',
    ]);
    // Menu berizin API tetap mengikuti izin sungguhan peran asli (tanpa kuasa tambahan).
    expect(all).toContain('audit');
    for (const id of ['akses', 'formulir', 'rm', 'devui']) expect(all).not.toContain(id);
  });

  it('mode api: tanda diabaikan total, menu sama persis dengan akun manajemen biasa', () => {
    const plain = navGroups({ ...manajemen, dataSource: 'api' });
    const flagged = navGroups({ ...manajemen, dataSource: 'api', allAccess: true });
    expect(flagged).toEqual(plain);
    expect(ids(flagged)).not.toContain('panduan');
    // Layar data dummy di mode api tetap redup (tidak bisa dibuka), tanda atau tidak.
    const open = flagged.flatMap((g) => g.items).filter((i) => i.available);
    expect(open.map((i) => i.id)).not.toContain('simulasi');
    expect(open.map((i) => i.id)).not.toContain('kasir');
  });

  it('tanpa tanda di mode presentasi: hanya layar posisi aslinya; tenant PLATFORM tidak pernah mendapat menu ini', () => {
    const plain = ids(navGroups({ ...manajemen, dataSource: 'demo' }));
    expect(plain).toContain('dasbor');
    expect(plain).not.toContain('kasir');
    expect(plain).not.toContain('panduan');
    const platform = navGroups({
      ...manajemen,
      kind: 'platform',
      dataSource: 'demo',
      allAccess: true,
      permissions: [],
    });
    expect(ids(platform)).toEqual(['beranda']);
  });

  it('menu tambahan: id unik terhadap menu dasar dan menu aktif dikenali', () => {
    const base = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
    for (const item of ALL_ACCESS_NAV.flatMap((g) => g.items)) expect(base.has(item.id), item.id).toBe(false);
    expect(activeNavId('/klinis/cppt')).toBe('cppt');
    expect(activeNavId('/tablet/persetujuan/x')).toBe('consent');
  });
});

describe('navGroups · modul aktif (mode presentasi)', () => {
  const ids = (groups: ReturnType<typeof navGroups>) => groups.flatMap((g) => g.items.map((i) => i.id));
  const demo = { kind: 'hospital' as const, superadmin: false, permissions: [], role: null, allAccess: true };

  it('layar yang semua komponennya dimatikan hilang dari menu; Pengaturan tetap ada', () => {
    const on = navGroups({ ...demo, dataSource: 'demo' });
    expect(ids(on)).toContain('lab');
    const off = navGroups({
      ...demo,
      dataSource: 'demo',
      modules: { S01: false, S09: false, P10: false, P12: false },
    });
    expect(ids(off)).not.toContain('lab');
    expect(ids(off)).toContain('pengaturan');
  });

  it('mode api mengabaikan modul dari toko demo', () => {
    const api = navGroups({
      ...demo,
      dataSource: 'api',
      permissions: ['patient.read'],
      modules: { S01: false },
    });
    const apiTanpa = navGroups({ ...demo, dataSource: 'api', permissions: ['patient.read'] });
    expect(ids(api)).toEqual(ids(apiTanpa));
  });
});
