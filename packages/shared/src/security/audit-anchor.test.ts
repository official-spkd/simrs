import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditAnchorKeyProblem } from '../env';
import {
  auditAnchorKeyId,
  auditAnchorMessage,
  auditAnchorObjectKey,
  createAuditAnchorDocument,
  parseAuditAnchorDocument,
  signAuditAnchor,
  verifyAuditAnchor,
} from './audit-anchor';

const KEY = randomBytes(32).toString('base64');
const A = {
  tenantId: '0199a000-0000-7000-8000-000000000001',
  seq: '42',
  hash: 'a'.repeat(64),
  anchoredAt: '2026-10-05T01:00:00.123Z',
};

describe('jangkar hash audit (ADR-0072)', () => {
  it('tanda tangan sah hanya untuk isi dan kunci yang sama; setiap bidang terikat', () => {
    const mac = signAuditAnchor(A, KEY);
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAuditAnchor(A, mac, KEY)).toBe(true);
    expect(verifyAuditAnchor(A, mac, randomBytes(32).toString('base64'))).toBe(false);
    for (const changed of [
      { ...A, seq: '41' },
      { ...A, hash: 'b'.repeat(64) },
      { ...A, anchoredAt: '2026-10-05T01:00:00.124Z' },
      { ...A, tenantId: '0199a000-0000-7000-8000-000000000002' },
    ]) {
      expect(verifyAuditAnchor(changed, mac, KEY)).toBe(false);
    }
    expect(verifyAuditAnchor(A, 'bukan-hex', KEY)).toBe(false);
    expect(auditAnchorMessage(A).split('\n')).toEqual([
      'simrs/audit-anchor/v1',
      A.tenantId,
      '42',
      A.hash,
      A.anchoredAt,
    ]);
  });

  it('kunci turunan per tenant: isi sama di tenant lain → HMAC lain; sidik kunci stabil', () => {
    const other = { ...A, tenantId: '0199a000-0000-7000-8000-000000000002' };
    expect(signAuditAnchor(other, KEY)).not.toBe(signAuditAnchor(A, KEY));
    expect(auditAnchorKeyId(KEY)).toMatch(/^[0-9a-f]{16}$/);
    expect(auditAnchorKeyId(KEY)).toBe(auditAnchorKeyId(KEY));
    expect(auditAnchorKeyId(randomBytes(32).toString('base64'))).not.toBe(auditAnchorKeyId(KEY));
    expect(() => signAuditAnchor(A, 'cGVuZGVr')).toThrow(/32 byte/);
  });

  it('dokumen WORM: kunci objek berurutan leksikal; isi rusak ditolak', () => {
    expect(auditAnchorObjectKey(A.tenantId, 42n)).toBe(
      `audit-anchors/${A.tenantId}/00000000000000000042.json`,
    );
    expect(auditAnchorObjectKey(A.tenantId, '9') < auditAnchorObjectKey(A.tenantId, '10')).toBe(true);
    const doc = createAuditAnchorDocument(A, KEY);
    expect(parseAuditAnchorDocument(Buffer.from(JSON.stringify(doc)))).toEqual(doc);
    expect(parseAuditAnchorDocument('{"v":1}')).toBeNull();
    expect(parseAuditAnchorDocument('bukan json')).toBeNull();
    expect(parseAuditAnchorDocument(JSON.stringify({ ...doc, extra: 1 }))).toBeNull();
  });

  it('kunci jangkar wajib di produksi dan tidak boleh sama dengan kunci kolom', () => {
    const field = { FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), FIELD_HASH_KEY: KEY };
    expect(auditAnchorKeyProblem({ APP_ENV: 'production', ...field })).toMatch(/wajib/);
    expect(auditAnchorKeyProblem({ APP_ENV: 'local', ...field })).toBeNull();
    expect(
      auditAnchorKeyProblem({ APP_ENV: 'local', AUDIT_ANCHOR_KEY: KEY.replace(/=$/, ''), ...field }),
    ).toMatch(/berbeda/);
    expect(
      auditAnchorKeyProblem({
        APP_ENV: 'production',
        AUDIT_ANCHOR_KEY: randomBytes(32).toString('base64'),
        ...field,
      }),
    ).toBeNull();
  });
});
