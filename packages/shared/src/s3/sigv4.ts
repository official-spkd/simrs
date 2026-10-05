import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 untuk klien S3 minimal (ADR-0020), hanya modul bawaan Node. Fungsi murni: waktu dan
 * kredensial masuk sebagai argumen sehingga bisa diuji dengan vektor resmi AWS.
 */

/** SHA-256 hex dari isi kosong (GET/HEAD tanpa body). */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** `s3` untuk S3/MinIO. */
  service: string;
}

export interface SigV4Input {
  method: string;
  /** Persis seperti header `Host` yang dikirim (dengan port bila bukan bawaan). */
  host: string;
  /** Path yang SUDAH di-encode (lihat `encodeS3Path`), sama dengan yang dikirim. */
  path: string;
  query?: Record<string, string>;
  /** Header lain yang ikut ditandatangani; `host` dan `x-amz-date` ditambahkan otomatis. */
  headers?: Record<string, string>;
  /** SHA-256 hex isi permintaan, atau `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
}

export interface SignedRequest {
  /** Semua header yang harus dikirim (nama huruf kecil), termasuk `authorization`. */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');

/** Encode RFC 3986 aturan SigV4: semua selain `A–Z a–z 0–9 - _ . ~` menjadi `%XX` (huruf besar). */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Path gaya path-style `/<bucket>/<kunci>`: tiap segmen di-encode sekali, pemisah `/` dipertahankan. */
export function encodeS3Path(bucket: string, key?: string): string {
  const segments = [bucket, ...(key === undefined ? [] : key.split('/'))];
  return `/${segments.map(uriEncode).join('/')}`;
}

/** Query kanonik: diurutkan menurut nama ter-encode; juga dipakai apa adanya di URL. */
export function canonicalQuery(query: Record<string, string> = {}): string {
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** `20130524T000000Z` */
export function amzDate(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function signV4(input: SigV4Input, creds: SigV4Credentials, now: Date): SignedRequest {
  const stamp = amzDate(now);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  headers.host = input.host;
  headers['x-amz-date'] = stamp;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery(input.query),
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), creds.region), creds.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}
