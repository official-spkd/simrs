import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_GRANTS, isPermission, PERMISSION_CATALOG, PROTECTED_ROLE, SYSTEM_ROLES } from './authz';

describe('katalog izin dan matriks bawaan', () => {
  it('setiap izin bawaan ada di katalog (salah ketik tidak diam-diam memberi/menghapus akses)', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_GRANTS)) {
      for (const [resource, action] of grants) {
        expect(isPermission(resource, action), `${role}: ${resource}.${action}`).toBe(true);
      }
    }
  });

  it('tidak ada izin ganda per peran', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_GRANTS)) {
      const keys = grants.map(([r, a]) => `${r}.${a}`);
      expect(new Set(keys).size, role).toBe(keys.length);
    }
  });

  it('hak minimum: hanya peran tertentu yang boleh mengubah peran, melihat NIK utuh, atau menggabung pasien', () => {
    const holders = (resource: string, action: string) =>
      Object.entries(DEFAULT_ROLE_GRANTS)
        .filter(([, g]) => g.some(([r, a]) => r === resource && a === action))
        .map(([role]) => role)
        .sort();
    expect(holders('iam.roles', 'write')).toEqual(['admin_tenant']);
    expect(holders('patient', 'merge')).toEqual(['petugas_rm']);
    expect(holders('patient.identity', 'read')).toEqual(['petugas_pendaftaran', 'petugas_rm']);
    expect(holders('break_glass', 'review')).toEqual(['petugas_privasi']);
  });

  it('16 peran bawaan, peran pelindung ada', () => {
    expect(Object.keys(SYSTEM_ROLES)).toHaveLength(16);
    expect(SYSTEM_ROLES[PROTECTED_ROLE]).toBeDefined();
    expect(isPermission('constructor', 'read')).toBe(false);
    expect(Object.keys(PERMISSION_CATALOG).length).toBeGreaterThan(10);
  });
});
