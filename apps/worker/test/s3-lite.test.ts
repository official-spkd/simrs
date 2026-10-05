/**
 * SigV4 klien S3 minimal (bucket WORM jangkar audit, ADR-0072) terhadap contoh resmi dokumentasi S3
 * ("Signature Version 4 header-based auth"). Tanpa jaringan; kredensial contoh AWS, bukan rahasia.
 */
import { describe, expect, it } from 'vitest';
import { canonicalQuery, EMPTY_SHA256, signV4, uriEncode, xmlValues } from '../src/audit/s3-lite';

const CREDS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};
const MAY_2013 = new Date('2013-05-24T00:00:00Z');
const HOST = 'examplebucket.s3.amazonaws.com';

describe('SigV4', () => {
  it('GET Object dengan Range (contoh resmi)', () => {
    const r = signV4(
      {
        method: 'GET',
        host: HOST,
        path: '/test.txt',
        headers: { Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256 },
        payloadHash: EMPTY_SHA256,
      },
      CREDS,
      MAY_2013,
    );
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('PUT Object: kunci ber-$ di-encode, header lain ikut ditandatangani (contoh resmi)', () => {
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
      CREDS,
      MAY_2013,
    );
    expect(r.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('query kanonik terurut dan ter-encode; XML dibaca aman', () => {
    expect(canonicalQuery({ versions: '', prefix: 'audit-anchors/a b/', 'key-marker': 'x' })).toBe(
      'key-marker=x&prefix=audit-anchors%2Fa%20b%2F&versions=',
    );
    expect(xmlValues('<A><Key>a&amp;b</Key><Key>c</Key></A>', 'Key')).toEqual(['a&b', 'c']);
  });
});
