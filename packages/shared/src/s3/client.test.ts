/**
 * Klien S3 minimal: ListObjectVersions (halaman bersambung, penanda hapus, entitas XML) dan Content-MD5, terhadap
 * server HTTP lokal yang meniru respons S3. Perilaku sungguhan terhadap MinIO diuji di apps/worker (bucket WORM).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentMd5, S3Client } from './client';

let server: Server;
const seen: URLSearchParams[] = [];

const page1 = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult><Name>b</Name><Prefix>p/</Prefix><IsTruncated>true</IsTruncated>
<NextKeyMarker>p/a&amp;1.json</NextKeyMarker><NextVersionIdMarker>v1</NextVersionIdMarker>
<Version><Key>p/a&amp;1.json</Key><VersionId>v2</VersionId><IsLatest>true</IsLatest></Version>
<Version><Key>p/a&amp;1.json</Key><VersionId>v1</VersionId><IsLatest>false</IsLatest></Version>
</ListVersionsResult>`;
const page2 = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult><IsTruncated>false</IsTruncated>
<DeleteMarker><Key>p/b.json</Key><VersionId>d1</VersionId><IsLatest>true</IsLatest></DeleteMarker>
<Version><Key>p/b.json</Key><VersionId>v3</VersionId><IsLatest>false</IsLatest></Version>
</ListVersionsResult>`;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    seen.push(q);
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(q.get('version-id-marker') === 'v1' ? page2 : page1);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const client = () =>
  new S3Client({
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });

describe('S3Client.listObjectVersions', () => {
  it('menyambung halaman dengan key/version marker, menandai penanda hapus, mendekode entitas XML', async () => {
    seen.length = 0;
    const versions = await client().listObjectVersions('b', 'p/', { keyMarker: 'p/0' });
    expect(versions).toEqual([
      { key: 'p/a&1.json', versionId: 'v2', isLatest: true, deleteMarker: false },
      { key: 'p/a&1.json', versionId: 'v1', isLatest: false, deleteMarker: false },
      { key: 'p/b.json', versionId: 'd1', isLatest: true, deleteMarker: true },
      { key: 'p/b.json', versionId: 'v3', isLatest: false, deleteMarker: false },
    ]);
    expect(seen.map((q) => [q.get('prefix'), q.get('key-marker'), q.get('version-id-marker')])).toEqual([
      ['p/', 'p/0', null],
      ['p/', 'p/a&1.json', 'v1'],
    ]);
    expect(seen.every((q) => q.has('versions'))).toBe(true);
  });
});

describe('contentMd5', () => {
  it('base64 MD5 isi (contoh RFC 1321)', () => {
    expect(contentMd5(Buffer.from(''))).toBe('1B2M2Y8AsgTpgAmY7PhCfg==');
    expect(contentMd5(Buffer.from('abc'))).toBe('kAFQmDzST7DWlj99KOF/cg==');
  });
});
