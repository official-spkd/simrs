import { describe, expect, it } from 'vitest';
import { ENCRYPTION_SCHEME } from '../src/crypto';
import {
  backupKeyFor,
  canonicalJson,
  type ManifestBody,
  ManifestError,
  parseBackupKey,
  parseManifest,
  sealManifest,
  serializeManifest,
} from '../src/manifest';

const SHA = 'a'.repeat(64);
const TENANT = '0199a000-0000-7000-8000-000000000001';

function body(): ManifestBody {
  return {
    format: 'simrs-backup-manifest/v1',
    backupKey: '20261005T031500Z-hourly',
    kind: 'hourly',
    startedAt: '2026-10-05T03:15:00.000Z',
    finishedAt: '2026-10-05T03:15:09.000Z',
    encryption: { scheme: ENCRYPTION_SCHEME, recipientKeyId: '0123456789abcdef' },
    database: {
      file: { name: 'db.dump.enc', plainBytes: 1000, plainSha256: SHA, encBytes: 1081, encSha256: SHA },
      name: 'simrs',
      serverVersion: '16.10',
      migrations: ['20261003000000_fondasi', '20261005110000_backup_runs'],
      tables: { 'public.patients': 230, 'public._prisma_migrations': 2, 'ref.concepts': 72 },
      auditHeads: [{ tenantId: TENANT, seq: '42', hash: SHA, firstBrokenSeq: null }],
      tenants: [{ id: TENANT, code: 'RSCM', kind: 'hospital', status: 'active' }],
    },
    documents: {
      file: { name: 'documents.tar.enc', plainBytes: 1024, plainSha256: SHA, encBytes: 1105, encSha256: SHA },
      source: 'disk',
      fileCount: 0,
      totalBytes: 0,
      integrityErrors: [],
    },
  };
}

describe('kunci backup', () => {
  it('waktu mulai UTC + jenis, bolak-balik', () => {
    const at = new Date('2026-10-05T03:15:09.876Z');
    const key = backupKeyFor(at, 'daily');
    expect(key).toBe('20261005T031509Z-daily');
    expect(parseBackupKey(key)).toEqual({ kind: 'daily', startedAt: new Date('2026-10-05T03:15:09Z') });
  });

  it.each(['20261305T031509Z-daily', '20261005T031509Z-weekly', '../20261005T031509Z-daily', 'lainnya', ''])(
    'menolak %j',
    (key) => {
      expect(parseBackupKey(key)).toBeNull();
    },
  );
});

describe('manifest', () => {
  it('JSON kanonik tidak bergantung urutan kunci', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it('disegel lalu dibaca ulang utuh', () => {
    const text = serializeManifest(sealManifest(body()));
    const m = parseManifest(text, '20261005T031500Z-hourly');
    expect(m.database.tables['public.patients']).toBe(230);
    expect(m.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('bukan JSON → MANIFEST_INVALID', () => {
    const text = serializeManifest(sealManifest(body()));
    expect(() => parseManifest(text.slice(0, -10))).toThrow(ManifestError);
    expect(() => parseManifest(text.slice(0, -10))).toThrow(/MANIFEST_INVALID/);
  });

  it('nilai diubah tetapi JSON tetap valid → MANIFEST_DIGEST_MISMATCH', () => {
    const text = serializeManifest(sealManifest(body())).replace(
      '"public.patients": 230',
      '"public.patients": 231',
    );
    expect(() => parseManifest(text)).toThrow(/MANIFEST_DIGEST_MISMATCH/);
  });

  it('kolom asing atau hilang → MANIFEST_INVALID', () => {
    const sealed = sealManifest(body());
    expect(() => parseManifest(JSON.stringify({ ...sealed, ekstra: 1 }))).toThrow(/MANIFEST_INVALID/);
    const { digest: _d, ...noDigest } = sealed;
    expect(() => parseManifest(JSON.stringify(noDigest))).toThrow(/MANIFEST_INVALID/);
  });

  it('manifest milik backup lain → MANIFEST_KEY_MISMATCH', () => {
    const text = serializeManifest(sealManifest(body()));
    expect(() => parseManifest(text, '20261005T041500Z-hourly')).toThrow(/MANIFEST_KEY_MISMATCH/);
  });

  it('nama berkas dan nama tabel dibatasi (tanpa path)', () => {
    const bad = body();
    bad.database.tables = { '../etc.passwd': 1 };
    expect(() => sealManifest(bad)).toThrow();
  });
});
