import { createHash, createHmac } from 'node:crypto';

/**
 * Klien S3 minimal untuk bucket WORM jangkar audit (ADR-0072): AWS Signature V4 + `fetch` bawaan Node, gaya path
 * (`/<bucket>/<kunci>`, cocok untuk MinIO). Sengaja kecil dan terisolasi; bentuk `signV4` sama dengan penanda tangan
 * driver dokumen P08 (agen I, `apps/api/src/infra/sigv4.ts`) sehingga keduanya bisa disatukan ke paket bersama.
 */

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface SigV4Input {
  method: string;
  /** Persis header `Host` yang dikirim (dengan port bila bukan bawaan). */
  host: string;
  /** Path yang sudah di-encode, sama dengan yang dikirim. */
  path: string;
  query?: Record<string, string>;
  /** Header lain yang ikut ditandatangani; `host` dan `x-amz-date` ditambahkan otomatis. */
  headers?: Record<string, string>;
  payloadHash: string;
}

export interface SignedRequest {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** Encode RFC 3986 aturan SigV4: selain `A–Z a–z 0–9 - _ . ~` menjadi `%XX`. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function canonicalQuery(query: Record<string, string> = {}): string {
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function signV4(input: SigV4Input, creds: SigV4Credentials, now: Date): SignedRequest {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
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

/** Galat S3: status HTTP + kode S3 (mis. `PreconditionFailed`, `AccessDenied`), tanpa kunci objek/kredensial. */
export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`S3 ${status} ${code}`);
    this.name = 'S3Error';
  }
}

export interface S3LiteConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  timeoutMs?: number;
}

export interface S3LiteRequest {
  method: 'GET' | 'HEAD' | 'PUT' | 'DELETE';
  bucket: string;
  key?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Buffer;
}

export interface S3LiteResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

/** Isi respons dibatasi: objek jangkar dan XML daftar kecil. */
const MAX_BODY = 4 * 1024 * 1024;

export class S3Lite {
  private readonly url: URL;

  constructor(private readonly cfg: S3LiteConfig) {
    this.url = new URL(cfg.endpoint);
    if (this.url.protocol !== 'http:' && this.url.protocol !== 'https:') {
      throw new Error('S3_ENDPOINT harus http(s)');
    }
  }

  async send(req: S3LiteRequest): Promise<S3LiteResponse> {
    const segments = [req.bucket, ...(req.key === undefined ? [] : req.key.split('/'))];
    const path = `/${segments.map(uriEncode).join('/')}`;
    const payloadHash = req.body ? sha256Hex(req.body) : EMPTY_SHA256;
    const signed = signV4(
      {
        method: req.method,
        host: this.url.host,
        path,
        query: req.query,
        headers: { ...req.headers, 'x-amz-content-sha256': payloadHash },
        payloadHash,
      },
      {
        accessKeyId: this.cfg.accessKeyId,
        secretAccessKey: this.cfg.secretAccessKey,
        region: this.cfg.region,
        service: 's3',
      },
      new Date(),
    );
    const { host: _host, ...headers } = signed.headers; // `fetch` mengisi Host sendiri dari URL yang sama
    const qs = canonicalQuery(req.query);
    const res = await fetch(`${this.url.origin}${path}${qs ? `?${qs}` : ''}`, {
      method: req.method,
      headers,
      body: req.body ? new Uint8Array(req.body) : undefined,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BODY) throw new S3Error(res.status, 'ResponseTooLarge');
    if (res.status >= 300) {
      const code = /<Code>([^<]{1,100})<\/Code>/.exec(body.toString('utf8'))?.[1];
      throw new S3Error(res.status, code ?? (res.status === 404 ? 'NotFound' : `HTTP${res.status}`));
    }
    return { status: res.status, headers: res.headers, body };
  }
}

/** Nilai teks tag XML sederhana (respons S3 tidak bersarang untuk bidang yang dibaca di sini). */
export function xmlValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) =>
    (m[1] ?? '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&'),
  );
}

export const md5Base64 = (body: Buffer) => createHash('md5').update(body).digest('base64');
