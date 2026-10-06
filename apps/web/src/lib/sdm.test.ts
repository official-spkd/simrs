import { describe, expect, it } from 'vitest';
import { draftRoster, EMPLOYEES, ROSTER_STAFF, ROSTER_UNIT } from './demo/fixtures/pegawai';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  assign,
  licenseStatus,
  licenseText,
  maskNik,
  publishBlock,
  restViolations,
  rosterGaps,
  shortName,
  unassign,
  weeklyHours,
  worstLicense,
} from './sdm';

describe('B03 · izin praktik', () => {
  it('STR seumur hidup selalu berlaku; SIP ≤ 60 hari "segera"; lewat = kedaluwarsa', () => {
    expect(licenseStatus(null, DEMO_TODAY)).toEqual({ status: 'aktif', days: null });
    expect(licenseStatus('2026-11-20', DEMO_TODAY)).toEqual({ status: 'segera', days: 46 });
    expect(licenseStatus('2026-12-04', DEMO_TODAY)).toEqual({ status: 'segera', days: 60 });
    expect(licenseStatus('2026-12-05', DEMO_TODAY).status).toBe('aktif');
    expect(licenseStatus('2026-09-30', DEMO_TODAY)).toEqual({ status: 'kedaluwarsa', days: -5 });
    expect(licenseText('kedaluwarsa', -5)).toBe('Kedaluwarsa 5 hari');
    expect(licenseText('segera', 46)).toBe('Berakhir 46 hari lagi');
  });

  it('status terburuk per pegawai; fixture punya izin kedaluwarsa dan yang segera berakhir', () => {
    const st = EMPLOYEES.map((e) => worstLicense(e.licenses, DEMO_TODAY).status);
    expect(st.filter((s) => s === 'kedaluwarsa')).toHaveLength(1);
    expect(st.filter((s) => s === 'segera').length).toBeGreaterThanOrEqual(3);
  });

  it('NIK fiktif tersamar dan selalu berawalan 9999', () => {
    expect(maskNik('9999160300000001')).toBe('9999••••••••0001');
    expect(shortName('Ns. Maya Sari, S.Kep')).toBe('Maya');
    expect(shortName('dr. Rina Kusuma')).toBe('Rina');
    for (const e of EMPLOYEES) {
      expect(e.nik).toMatch(/^9999\d{12}$/);
      expect(e.nip.startsWith('9999-')).toBe(true);
    }
    expect(new Set(EMPLOYEES.map((e) => e.id)).size).toBe(EMPLOYEES.length);
  });
});

describe('B03 · jadwal dinas', () => {
  it('draf memuat dua dinas kurang dan satu jeda istirahat dilanggar; terbit ditahan', () => {
    const r = draftRoster();
    const gaps = rosterGaps(r, 7, ROSTER_UNIT.minimum);
    expect(gaps.map((g) => `${g.day}${g.shift}`)).toEqual(['2S', '5M']);
    const v = restViolations(r, 7);
    expect(v).toHaveLength(1);
    expect(v[0]?.day).toBe(4);
    expect(publishBlock(gaps, v)).toMatch(/2 dinas/);
  });

  it('mengisi kekosongan dan memperbaiki jeda membuka gerbang terbit', () => {
    const ward = ROSTER_STAFF.filter((e) => e.unit === 'Ruang Melati').map((e) => e.id);
    const float = ROSTER_STAFF.find((e) => e.unit === 'Pool keperawatan')?.id ?? '';
    let r = draftRoster();
    r = assign(r, 2, 'S', ward[1] ?? '');
    r = assign(r, 5, 'M', float);
    r = unassign(r, 4, 'P', ward[0] ?? '');
    expect(publishBlock(rosterGaps(r, 7, ROSTER_UNIT.minimum), restViolations(r, 7))).toMatch(/1 dinas/);
    r = assign(r, 4, 'P', ward[4] ?? '');
    expect(publishBlock(rosterGaps(r, 7, ROSTER_UNIT.minimum), restViolations(r, 7))).toBeNull();
    expect(weeklyHours(r, float)).toBe(10);
    expect(assign(r, 4, 'P', ward[4] ?? '')).toBe(r);
  });
});
