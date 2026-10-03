import { describe, expect, it } from 'vitest';
import {
  CORE_MODULES,
  createLocationSchema,
  createUnitSchema,
  defaultModuleEnabled,
  formatDocumentNumber,
  isTenantSettingKey,
  numberPeriod,
  parseTenantSetting,
  TENANT_SETTINGS,
} from './index';

describe('penomoran (docs/04 §5)', () => {
  it('memformat sesuai contoh dokumen', () => {
    expect(formatDocumentNumber('mrn', 412788n, '')).toBe('00-41-27-88');
    expect(formatDocumentNumber('encounter_rj', 123n, '2610')).toBe('RJ-2610-000123');
    expect(formatDocumentNumber('invoice', 2217n, '2610')).toBe('INV-2610-02217');
    expect(formatDocumentNumber('journal', 388n, '2610')).toBe('JU-26100388');
    expect(formatDocumentNumber('payment_bill', 412n, '2610')).toBe('INV-DP-2610-0412');
  });

  it('menolak nilai di luar kapasitas (bukan dipotong diam-diam)', () => {
    expect(() => formatDocumentNumber('mrn', 100_000_000n, '')).toThrow(RangeError);
    expect(() => formatDocumentNumber('invoice', 0n, '2610')).toThrow(RangeError);
  });

  it('periode bulanan mengikuti WIB; No. RM tanpa periode', () => {
    expect(numberPeriod('encounter_rj', new Date('2026-10-31T18:00:00Z'))).toBe('2611');
    expect(numberPeriod('mrn', new Date())).toBe('');
  });
});

describe('pengaturan tenant', () => {
  it('hanya kunci terdaftar; nilai divalidasi', () => {
    expect(isTenantSettingKey('session.idle_minutes')).toBe(true);
    expect(isTenantSettingKey('constructor')).toBe(false);
    expect(isTenantSettingKey('tidak.ada')).toBe(false);
    expect(parseTenantSetting('session.idle_minutes', 20)).toBe(20);
    expect(() => parseTenantSetting('password.min_length', 8)).toThrow();
    expect(() => parseTenantSetting('service.hours', { open: '21:00', close: '07:00' })).toThrow();
    expect(() => parseTenantSetting('service.hours', { open: '07:00', close: '21:00', x: 1 })).toThrow();
  });

  it('setiap bawaan lolos skemanya sendiri', () => {
    for (const [key, d] of Object.entries(TENANT_SETTINGS)) {
      expect(() => d.schema.parse(d.default), key).not.toThrow();
    }
  });
});

describe('modul', () => {
  it('modul inti aktif secara bawaan; modul "Lanjut" mati', () => {
    for (const code of CORE_MODULES) expect(defaultModuleEnabled(code)).toBe(true);
    expect(defaultModuleEnabled('B02')).toBe(false);
  });
});

describe('skema faskes', () => {
  it('kode dinormalisasi kapital; field tak dikenal ditolak', () => {
    const u = createUnitSchema.parse({
      facilityId: '0199a000-0000-7000-8000-000000000001',
      code: ' poli-dalam ',
      name: 'Poli Penyakit Dalam',
      kind: 'poli',
    });
    expect(u.code).toBe('POLI-DALAM');
    expect(() =>
      createLocationSchema.parse({
        unitId: '0199a000-0000-7000-8000-000000000001',
        kind: 'bed',
        code: 'B1',
        name: 'Bed 1',
        tenantId: 'x',
      }),
    ).toThrow();
  });
});
