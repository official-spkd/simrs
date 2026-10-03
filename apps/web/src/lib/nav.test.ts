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
  it('grup superadmin hanya tampil bila akses terbuka', () => {
    expect(navGroups({ superadmin: false }).map((g) => g.title)).not.toContain('SUPERADMIN');
    expect(navGroups({ superadmin: true }).at(-1)?.title).toBe('SUPERADMIN');
  });
});
