/**
 * SigV4 (klien S3 minimal, ADR-0020) terhadap vektor resmi AWS: contoh "Signature Version 4 header-based auth"
 * di dokumentasi S3 dan `get-vanilla` dari aws-sig-v4-test-suite. Tanpa jaringan.
 */
import { describe, expect, it } from 'vitest';
import {
  amzDate,
  canonicalQuery,
  EMPTY_SHA256,
  encodeS3Path,
  type SigV4Credentials,
  signV4,
  uriEncode,
} from '../src/infra/sigv4';

/** Kredensial contoh dari dokumentasi S3 (bukan rahasia). */
const S3_DOCS: SigV4Credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};
const MAY_2013 = new Date('2013-05-24T00:00:00Z');
const HOST = 'examplebucket.s3.amazonaws.com';

describe('SigV4: contoh dokumentasi S3', () => {
  it('GET Object dengan Range', () => {
    const r = signV4(
      {
        method: 'GET',
        host: HOST,
        path: '/test.txt',
        headers: { Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256 },
        payloadHash: EMPTY_SHA256,
      },
      S3_DOCS,
      MAY_2013,
    );
    expect(r.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        '',
        `host:${HOST}`,
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    );
    expect(r.stringToSign.split('\n')).toEqual([
      'AWS4-HMAC-SHA256',
      '20130524T000000Z',
      '20130524/us-east-1/s3/aws4_request',
      '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972',
    ]);
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('PUT Object: kunci ber-$ di-encode, header lain ikut ditandatangani', () => {
    const payload = Buffer.from('Welcome to Amazon S3.');
    const hash = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072';
    const r = signV4(
      {
        method: 'PUT',
        host: HOST,
        path: `/${uriEncode('test$file.text')}`,
        headers: {
          Date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
          'x-amz-content-sha256': hash,
        },
        payloadHash: hash,
      },
      S3_DOCS,
      MAY_2013,
    );
    expect(payload.length).toBe(21);
    expect(r.canonicalRequest.split('\n').slice(0, 2)).toEqual(['PUT', '/test%24file.text']);
    expect(r.stringToSign.split('\n')[3]).toBe(
      '9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d',
    );
    expect(r.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('GET Bucket lifecycle (query tanpa nilai) dan daftar objek (query terurut)', () => {
    const lifecycle = signV4(
      {
        method: 'GET',
        host: HOST,
        path: '/',
        query: { lifecycle: '' },
        headers: { 'x-amz-content-sha256': EMPTY_SHA256 },
        payloadHash: EMPTY_SHA256,
      },
      S3_DOCS,
      MAY_2013,
    );
    expect(lifecycle.signature).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
    const list = signV4(
      {
        method: 'GET',
        host: HOST,
        path: '/',
        query: { prefix: 'J', 'max-keys': '2' },
        headers: { 'x-amz-content-sha256': EMPTY_SHA256 },
        payloadHash: EMPTY_SHA256,
      },
      S3_DOCS,
      MAY_2013,
    );
    expect(list.canonicalRequest.split('\n')[2]).toBe('max-keys=2&prefix=J');
    expect(list.signature).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('SigV4: aws-sig-v4-test-suite', () => {
  it('get-vanilla (layanan generik, tanpa header isi)', () => {
    const r = signV4(
      { method: 'GET', host: 'example.amazonaws.com', path: '/', payloadHash: EMPTY_SHA256 },
      {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 'service',
      },
      new Date('2015-08-30T12:36:00Z'),
    );
    expect(r.stringToSign.split('\n')[3]).toBe(
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
    );
    expect(r.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });
});

describe('SigV4: encoding', () => {
  it('RFC 3986: hanya karakter tak-bercadang yang dibiarkan; spasi %20, bukan +', () => {
    expect(uriEncode("a b+c/d~e_f-g.h!*'()")).toBe('a%20b%2Bc%2Fd~e_f-g.h%21%2A%27%28%29');
    expect(encodeS3Path('simrs-documents', '0199a000/2026/10/abc')).toBe(
      '/simrs-documents/0199a000/2026/10/abc',
    );
    expect(encodeS3Path('ember')).toBe('/ember');
    expect(canonicalQuery({ b: '2', a: 'x y', 'list-type': '2' })).toBe('a=x%20y&b=2&list-type=2');
    expect(amzDate(new Date('2026-10-05T03:04:05.678Z'))).toBe('20261005T030405Z');
  });

  it('nilai header dirapikan (spasi ganda jadi satu, nama huruf kecil)', () => {
    const r = signV4(
      {
        method: 'HEAD',
        host: 'localhost:9000',
        path: '/ember',
        headers: { 'X-Amz-Meta-Catatan': '  dua   spasi ', 'x-amz-content-sha256': EMPTY_SHA256 },
        payloadHash: EMPTY_SHA256,
      },
      S3_DOCS,
      MAY_2013,
    );
    expect(r.canonicalRequest).toContain('x-amz-meta-catatan:dua spasi\n');
    expect(r.headers).toMatchObject({ host: 'localhost:9000', 'x-amz-date': '20130524T000000Z' });
  });
});
