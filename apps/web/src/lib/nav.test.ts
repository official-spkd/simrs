import { describe, expect, it } from 'vitest';
import { activeNavId, NAV_GROUPS, navGroups, SUPERADMIN_GROUP } from './nav';

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

  it('menu berizin hanya tampil bila peran memegang izinnya', () => {
    const perawat = navGroups({ kind: 'hospital', superadmin: false, permissions: ['patient.read'] });
    expect(ids(perawat)).not.toContain('akses');
    expect(ids(perawat)).toContain('igd');
    const admin = navGroups({ kind: 'hospital', superadmin: false, permissions: ['iam.users.read'] });
    expect(ids(admin)).toContain('akses');
  });

  it('grup superadmin hanya untuk superadmin; tenant PLATFORM tanpa menu klinis', () => {
    expect(
      navGroups({ kind: 'hospital', superadmin: false, permissions: [] }).map((g) => g.title),
    ).not.toContain('SUPERADMIN');
    const platform = navGroups({ kind: 'platform', superadmin: true, permissions: ['iam.users.read'] });
    expect(platform.at(-1)?.title).toBe('SUPERADMIN');
    expect(ids(platform)).toEqual(['beranda', 'akses', 'panduan', 'devui']);
  });
});
