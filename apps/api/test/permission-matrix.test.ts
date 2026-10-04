/**
 * P03 · Cache matriks izin (logika murni, tanpa database/Redis): pemuat palsu menghitung pembacaan "DB",
 * jam palsu untuk TTL, dan saklar jalur invalidasi antar-instans.
 */
import type { PermissionScope } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { PermissionMatrixCache } from '../src/infra/permission-matrix';

const A = '0199a000-0000-7000-8000-00000000c0a1';
const B = '0199a000-0000-7000-8000-00000000c0b2';

function setup(ttlMs = 30_000) {
  let now = 1_000_000;
  let live = true;
  /** "Database": `${tenant}:${role}` → izin. */
  const db = new Map<string, Map<string, PermissionScope>>();
  const loads: string[] = [];
  let gate: Promise<void> | null = null;
  const cache = new PermissionMatrixCache({
    ttlMs,
    now: () => now,
    live: () => live,
    load: async (tenantId, role) => {
      loads.push(`${tenantId}:${role}`);
      // Salin saat dibaca (seperti hasil kueri), lalu tunggu gerbang bila tes menahan pemuatan.
      const snapshot = new Map(db.get(`${tenantId}:${role}`) ?? []);
      if (gate) await gate;
      return snapshot;
    },
  });
  return {
    cache,
    loads,
    grant: (tenantId: string, role: string, key: string, scope: PermissionScope) => {
      const m = db.get(`${tenantId}:${role}`) ?? new Map<string, PermissionScope>();
      m.set(key, scope);
      db.set(`${tenantId}:${role}`, m);
    },
    revoke: (tenantId: string, role: string, key: string) => db.get(`${tenantId}:${role}`)?.delete(key),
    tick: (ms: number) => {
      now += ms;
    },
    setLive: (v: boolean) => {
      live = v;
    },
    hold: () => {
      let release = () => {};
      gate = new Promise<void>((r) => {
        release = r;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

describe('cache matriks izin', () => {
  it('cache hit tidak membaca database; satu muat melayani semua aksi peran itu', async () => {
    const s = setup();
    s.grant(A, 'perawat', 'patient.read', 'relationship');
    expect(await s.cache.scope(A, 'perawat', 'patient', 'read')).toBe('relationship');
    s.revoke(A, 'perawat', 'patient.read'); // perubahan tanpa invalidasi: cache tetap dipakai
    expect(await s.cache.scope(A, 'perawat', 'patient', 'read')).toBe('relationship');
    expect(await s.cache.scope(A, 'perawat', 'iam.users', 'read')).toBeNull();
    expect(s.loads).toEqual([`${A}:perawat`]);
    expect(s.cache.stats).toEqual({ hits: 2, loads: 1 });
  });

  it('invalidasi tenant berlaku seketika di instans ini', async () => {
    const s = setup();
    s.grant(A, 'auditor_mutu', 'audit.read', 'all');
    expect(await s.cache.scope(A, 'auditor_mutu', 'audit', 'read')).toBe('all');
    s.revoke(A, 'auditor_mutu', 'audit.read');
    s.cache.invalidateTenant(A);
    expect(await s.cache.scope(A, 'auditor_mutu', 'audit', 'read')).toBeNull();
    expect(s.loads).toHaveLength(2);
  });

  it('cache tenant A tidak pernah melayani tenant B (kode peran sama), invalidasi A tidak menyentuh B', async () => {
    const s = setup();
    s.grant(A, 'kasir', 'documents.print', 'all');
    expect(await s.cache.scope(A, 'kasir', 'documents', 'print')).toBe('all');
    // Tenant B: peran berkode sama tanpa izin itu → dimuat sendiri, bukan memakai baris A.
    expect(await s.cache.scope(B, 'kasir', 'documents', 'print')).toBeNull();
    expect(s.loads).toEqual([`${A}:kasir`, `${B}:kasir`]);
    s.cache.invalidateTenant(A);
    expect(await s.cache.scope(B, 'kasir', 'documents', 'print')).toBeNull();
    expect(await s.cache.scope(A, 'kasir', 'documents', 'print')).toBe('all');
    expect(s.loads).toEqual([`${A}:kasir`, `${B}:kasir`, `${A}:kasir`]);
  });

  it('TTL habis → dimuat ulang (jaring pengaman perubahan yang siarannya terlewat)', async () => {
    const s = setup(30_000);
    s.grant(A, 'dokter', 'documents.write', 'relationship');
    await s.cache.scope(A, 'dokter', 'documents', 'write');
    s.revoke(A, 'dokter', 'documents.write');
    s.tick(29_999);
    expect(await s.cache.scope(A, 'dokter', 'documents', 'write')).toBe('relationship');
    s.tick(1);
    expect(await s.cache.scope(A, 'dokter', 'documents', 'write')).toBeNull();
    expect(s.loads).toHaveLength(2);
  });

  it('jalur invalidasi (Redis) putus → setiap pemeriksaan membaca database; tersambung lagi → cache lama dibuang', async () => {
    const s = setup();
    s.grant(A, 'perawat', 'patient.read', 'relationship');
    await s.cache.scope(A, 'perawat', 'patient', 'read');
    s.setLive(false);
    s.revoke(A, 'perawat', 'patient.read');
    expect(await s.cache.scope(A, 'perawat', 'patient', 'read')).toBeNull();
    expect(await s.cache.scope(A, 'perawat', 'patient', 'read')).toBeNull();
    expect(s.loads).toHaveLength(3);
    // Instans lain mengubah matriks selama putus (pesannya terlewat); saat tersambung lagi cache dibuang.
    s.cache.clear();
    s.setLive(true);
    s.grant(A, 'perawat', 'patient.read', 'relationship');
    expect(await s.cache.scope(A, 'perawat', 'patient', 'read')).toBe('relationship');
    expect(s.loads).toHaveLength(4);
  });

  it('muat yang berjalan saat invalidasi tidak disimpan (tidak ada matriks lama setelah commit)', async () => {
    const s = setup();
    s.grant(A, 'koder', 'patient.read', 'all');
    const release = s.hold();
    // Permintaan 1 membaca matriks lama (sebelum perubahan admin di-commit) ...
    const inFlight = s.cache.scope(A, 'koder', 'patient', 'read');
    // ... lalu perubahan admin commit dan cache diinvalidasi sebelum permintaan 1 selesai.
    s.revoke(A, 'koder', 'patient.read');
    s.cache.invalidateTenant(A);
    release();
    expect(await inFlight).toBe('all');
    // Hasil lama tidak tersimpan: permintaan berikutnya membaca matriks baru.
    expect(await s.cache.scope(A, 'koder', 'patient', 'read')).toBeNull();
    expect(s.loads).toHaveLength(2);
  });

  it('TTL 0 = cache mati', async () => {
    const s = setup(0);
    s.grant(A, 'perawat', 'patient.read', 'relationship');
    await s.cache.scope(A, 'perawat', 'patient', 'read');
    await s.cache.scope(A, 'perawat', 'patient', 'read');
    expect(s.cache.stats).toEqual({ hits: 0, loads: 2 });
  });
});
