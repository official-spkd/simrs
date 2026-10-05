import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createAuditAnchorDocument, type S3Client, S3Error, type S3Request } from '@simrs/shared/node';
import { describe, expect, it } from 'vitest';
import { type AnchorCandidate, judgeAnchor, pickAnchor } from '../src/anchors';
import { S3DocumentSource } from '../src/documents';
import { extractTar, tarFromEntries } from '../src/tar';

const KEY = randomBytes(32).toString('base64');
const TENANT = '0199a000-0000-7000-8000-000000000001';
const BACKUP = new Date('2026-10-05T03:00:00.000Z');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

function anchor(seq: number, at: string, key = KEY): AnchorCandidate {
  return createAuditAnchorDocument(
    { tenantId: TENANT, seq: String(seq), hash: hash(`e${seq}`), anchoredAt: at },
    key,
  );
}

describe('jangkar audit untuk uji restore (ADR-0072)', () => {
  it('jangkar sesudah backup tidak dipakai; yang sah terbaru sebelum backup dipilih', async () => {
    const list = [
      anchor(30, '2026-10-05T04:00:00.000Z'),
      anchor(20, '2026-10-05T02:00:00.000Z'),
      anchor(10, '2026-10-05T01:00:00.000Z'),
    ];
    expect(judgeAnchor(list[0] as AnchorCandidate, BACKUP, KEY)).toBe('after_backup');
    const picked = await pickAnchor(list, BACKUP, KEY);
    expect(picked).toEqual({ anchor: list[1], rejected: 0 });
  });

  it('jangkar palsu (HMAC salah) atau kunci lain dilewati dan dihitung', async () => {
    const forged = { ...anchor(25, '2026-10-05T02:30:00.000Z'), hash: hash('palsu') };
    const otherKey = anchor(24, '2026-10-05T02:20:00.000Z', randomBytes(32).toString('base64'));
    const good = anchor(20, '2026-10-05T02:00:00.000Z');
    expect(judgeAnchor(forged, BACKUP, KEY)).toBe('tampered');
    expect(judgeAnchor(otherKey, BACKUP, KEY)).toBe('key_unknown');
    expect(await pickAnchor([forged, otherKey, good], BACKUP, KEY)).toEqual({ anchor: good, rejected: 2 });
  });

  it('tanpa kunci: tanda tangan tidak dinilai (hanya waktu)', async () => {
    const forged = { ...anchor(25, '2026-10-05T02:30:00.000Z'), hmac: 'f'.repeat(64) };
    expect((await pickAnchor([forged], BACKUP)).anchor).toBe(forged);
    expect(await pickAnchor([], BACKUP, KEY)).toEqual({ anchor: null, rejected: 0 });
  });
});

/** S3 palsu: GET mengembalikan isi dari peta, 404 bila tidak ada. */
function fakeS3(objects: Map<string, Buffer>): S3Client {
  return {
    request: async (req: S3Request) => {
      const body = objects.get(req.key ?? '');
      if (!body) throw new S3Error(404, 'NoSuchKey');
      return { status: 200, headers: { 'content-length': String(body.length) }, body: Readable.from([body]) };
    },
  } as unknown as S3Client;
}

describe('dokumen driver s3 (ADR-0071)', () => {
  it('objek per baris diarsipkan; hilang, ukuran beda, dan hash beda tercatat sebagai temuan sumber', async () => {
    const k = () => `${TENANT}/2026/10/${randomUUID()}`;
    const [ok, missing, wrongSize, wrongHash] = [k(), k(), k(), k()];
    const okBody = randomBytes(700);
    const objects = new Map<string, Buffer>([
      [ok, okBody],
      [wrongSize, randomBytes(10)],
      [wrongHash, randomBytes(50)],
    ]);
    const rows = [
      { key: ok, sha256: createHash('sha256').update(okBody).digest('hex'), size: 700 },
      { key: missing, sha256: hash('x'), size: 5 },
      { key: wrongSize, sha256: hash('y'), size: 11 },
      { key: wrongHash, sha256: hash('z'), size: 50 },
    ];
    const source = new S3DocumentSource(fakeS3(objects), 'simrs-documents', rows);
    const seen: string[] = [];
    const archive = tarFromEntries(source.entries(), (r) => {
      seen.push(r.key);
      source.onEntry(r);
    });
    const result = await extractTar(archive, null);
    expect(result.files).toBe(3);
    expect(seen).toEqual([ok, wrongSize, wrongHash]);
    expect(source.errors).toEqual([
      { key: missing, reason: 'missing' },
      { key: wrongSize, reason: 'size' },
      { key: wrongHash, reason: 'sha256' },
    ]);
  });

  it('isi lebih pendek dari ukuran header = galat (arsip tidak pernah tidak konsisten diam-diam)', async () => {
    const key = `${TENANT}/2026/10/${randomUUID()}`;
    const archive = tarFromEntries([{ key, size: 10, body: Readable.from([Buffer.alloc(4)]) }]);
    await expect(extractTar(archive, null)).rejects.toThrow(/lebih pendek/);
  });
});
