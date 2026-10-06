import { COMPONENTS, CORE_MODULES, TENANT_SETTINGS } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_MODULE_OVERRIDES, DEMO_SETTINGS, DEMO_TEMPLATES } from './demo/fixtures/platform';
import {
  activeDependents,
  canToggle,
  changedSettings,
  MODULE_CODES,
  MODULE_DEPENDS,
  moduleDiff,
  moduleStateFrom,
  SETTING_GROUPS,
  templateIssues,
  validateSettings,
} from './platform-pengaturan';

const state = moduleStateFrom(DEMO_MODULE_OVERRIDES);

describe('P10 · modul aktif', () => {
  it('peta dependensi hanya memakai kode katalog; keadaan awal RS konsisten (tidak ada modul aktif tanpa dependensinya)', () => {
    for (const [code, deps] of Object.entries(MODULE_DEPENDS)) {
      expect(Object.hasOwn(COMPONENTS, code), code).toBe(true);
      for (const d of deps ?? []) expect(Object.hasOwn(COMPONENTS, d), `${code} → ${d}`).toBe(true);
    }
    for (const c of MODULE_CODES) {
      if (!state[c]) continue;
      for (const d of MODULE_DEPENDS[c] ?? []) expect(state[d], `${c} butuh ${d}`).toBe(true);
    }
    for (const c of CORE_MODULES) expect(state[c]).toBe(true);
  });

  it('modul inti dan modul yang dipakai modul aktif lain tidak bisa dimatikan', () => {
    expect(canToggle('P01', state)).toEqual({ ok: false, reason: 'Modul inti, tidak bisa dimatikan.' });
    expect(activeDependents('S01', state)).toEqual(expect.arrayContaining(['S02', 'S09', 'K14']));
    expect(canToggle('S01', state).ok).toBe(false);
    expect(canToggle('S07', state).ok).toBe(true);
  });

  it('modul tidak bisa dinyalakan sebelum dependensinya aktif', () => {
    expect(state.B02).toBe(false);
    const noB01 = { ...state, S05: false, B01: false };
    expect(canToggle('B02', noB01)).toEqual({ ok: false, reason: 'Butuh B01 aktif dulu.' });
    expect(canToggle('S08', state).ok).toBe(true);
  });

  it('draf perubahan dibandingkan dengan yang tersimpan', () => {
    expect(moduleDiff(state, { ...state, S07: false, S08: true })).toEqual([
      { code: 'S07', on: false },
      { code: 'S08', on: true },
    ]);
  });
});

describe('P10 · pengaturan umum', () => {
  it('fixture memakai kunci registri dengan nilai valid', () => {
    for (const g of SETTING_GROUPS) for (const k of g.keys) expect(DEMO_SETTINGS[k], k).toBeDefined();
    expect(validateSettings(DEMO_SETTINGS)).toEqual({});
    for (const k of Object.keys(DEMO_SETTINGS)) expect(Object.hasOwn(TENANT_SETTINGS, k)).toBe(true);
  });

  it('galat memakai batas skema bersama API', () => {
    expect(validateSettings({ 'session.idle_minutes': '3' })).toEqual({
      'session.idle_minutes': 'Minimal 5',
    });
    expect(validateSettings({ 'session.idle_minutes': '90' })).toEqual({
      'session.idle_minutes': 'Maksimal 60',
    });
    expect(validateSettings({ 'session.idle_minutes': 'abc' })).toEqual({
      'session.idle_minutes': 'Isi dengan angka',
    });
    expect(validateSettings({ 'service.hours': { open: '21:00', close: '07:00' } })).toEqual({
      'service.hours': 'Jam buka harus sebelum jam tutup',
    });
  });

  it('perubahan dihitung dari nilai angka, bukan teks isian', () => {
    expect(changedSettings(DEMO_SETTINGS, { 'session.idle_minutes': '15' })).toEqual([]);
    expect(changedSettings(DEMO_SETTINGS, { 'session.idle_minutes': '20' })).toEqual([
      'session.idle_minutes',
    ]);
  });
});

describe('P12 · template cetak', () => {
  it('template tersimpan memenuhi syarat terbit', () => {
    for (const t of DEMO_TEMPLATES) expect(templateIssues(t), t.id).toEqual([]);
  });

  it('gelang wajib alergi + barcode; dokumen ber-TTE wajib QR', () => {
    const gelang = DEMO_TEMPLATES.find((t) => t.id === 'gelang');
    const kop = DEMO_TEMPLATES.find((t) => t.id === 'kop');
    if (!gelang || !kop) throw new Error('fixture');
    expect(templateIssues({ ...gelang, showAllergy: false, showBarcode: false })).toHaveLength(2);
    expect(templateIssues({ ...kop, showQr: false })).toEqual([
      'Dokumen bertanda tangan elektronik wajib memuat QR verifikasi.',
    ]);
    expect(templateIssues({ ...kop, header: '' })[0]).toMatch(/kop/);
  });
});
