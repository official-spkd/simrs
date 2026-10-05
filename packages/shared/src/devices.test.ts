import { describe, expect, it } from 'vitest';
import {
  createDeviceSchema,
  DEVICE_HOME,
  DEVICE_PERMISSIONS,
  DEVICE_PRINCIPAL_KINDS,
  devicePermissions,
  ENROLMENT_ALPHABET,
  enrolDeviceSchema,
  formatEnrolmentCode,
  normalizeEnrolmentCode,
} from './devices';

describe('prinsipal perangkat (ADR-0027)', () => {
  it('izin tetap per jenis, tanpa izin manusia', () => {
    expect(devicePermissions('kiosk')).toEqual(['kiosk.use']);
    expect(devicePermissions('display')).toEqual(['queue.display.read']);
    for (const kind of DEVICE_PRINCIPAL_KINDS) {
      for (const p of DEVICE_PERMISSIONS[kind]) {
        expect(p).not.toMatch(/^(patient|iam|audit|tenant|forms|documents|break_glass)\./);
      }
      expect(DEVICE_HOME[kind]).toMatch(/^\//);
    }
  });

  it('kode pendaftaran: ketikan longgar dibakukan, selain alfabet ditolak', () => {
    expect(ENROLMENT_ALPHABET).toHaveLength(32);
    expect(normalizeEnrolmentCode('abcde-12345')).toBe('ABCDE12345');
    expect(normalizeEnrolmentCode(' abcde 12345 ')).toBe('ABCDE12345');
    expect(normalizeEnrolmentCode('OOOOO-IIIII')).toBe('0000011111');
    expect(normalizeEnrolmentCode('LLLLL-00000')).toBe('1111100000');
    expect(normalizeEnrolmentCode('ABCDE-1234')).toBeNull();
    expect(normalizeEnrolmentCode('ABCDE-1234U')).toBeNull();
    expect(normalizeEnrolmentCode('ABCDE-1234!')).toBeNull();
    expect(formatEnrolmentCode('ABCDE12345')).toBe('ABCDE-12345');
  });

  it('skema masukan', () => {
    expect(
      createDeviceSchema.safeParse({
        kind: 'kiosk',
        name: 'Anjungan lobi',
        unitId: '0199a000-0000-7000-8000-000000000001',
      }).success,
    ).toBe(true);
    expect(createDeviceSchema.safeParse({ kind: 'staff_pin', name: 'x', unitId: 'y' }).success).toBe(false);
    expect(enrolDeviceSchema.parse({ tenantCode: 'rsfa', code: 'ABCDE-12345' })).toEqual({
      tenantCode: 'RSFA',
      code: 'ABCDE-12345',
    });
  });
});
