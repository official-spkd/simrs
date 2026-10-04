import { createHash } from 'node:crypto';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';
import { canonicalQuery, EMPTY_SHA256, encodeS3Path, signV4 } from './sigv4';

/**
 * Klien S3 minimal (ADR-0020): permintaan bertanda tangan SigV4 bergaya path (`/<bucket>/<kunci>`, cocok untuk
 * MinIO dan S3-compatible lain) di atas `node:http(s)`, tanpa SDK. Respons sukses diserahkan sebagai stream.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Batas diam soket (ms) saat menyambung, mengirim, dan membaca; unggahan dibatasi 10 MB. */
  timeoutMs?: number;
}

export interface S3Request {
  method: 'GET' | 'HEAD' | 'PUT' | 'DELETE';
  bucket: string;
  key?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Buffer;
  /** SHA-256 hex isi bila sudah dihitung pemanggil (diverifikasi server lewat `x-amz-content-sha256`). */
  payloadHash?: string;
}

export interface S3Response {
  status: number;
  headers: IncomingHttpHeaders;
  body: Readable;
}

/** Galat dari S3: status HTTP + kode S3 (mis. `NoSuchKey`, `PreconditionFailed`). Tanpa kunci objek. */
export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`S3 ${status} ${code}`);
    this.name = 'S3Error';
  }
}

const MAX_ERROR_BODY = 16 * 1024;

/** Baca isi respons sampai `limit` byte; lebih dari itu → stream dihentikan dan `null`. */
async function readLimited(body: Readable, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limit) {
      body.destroy();
      return null;
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export class S3Client {
  private readonly url: URL;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: S3Config) {
    this.url = new URL(cfg.endpoint);
    if (this.url.protocol !== 'http:' && this.url.protocol !== 'https:') {
      throw new Error('S3_ENDPOINT harus http(s)');
    }
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  /** Permintaan bertanda tangan. Status ≥ 300 → `S3Error` (isi galat dibaca dan dibuang). */
  request(req: S3Request): Promise<S3Response> {
    const path = encodeS3Path(req.bucket, req.key);
    const payloadHash =
      req.payloadHash ?? (req.body ? createHash('sha256').update(req.body).digest('hex') : EMPTY_SHA256);
    const signed = signV4(
      {
        method: req.method,
        host: this.url.host,
        path,
        query: req.query,
        headers: {
          ...req.headers,
          'x-amz-content-sha256': payloadHash,
          ...(req.body ? { 'content-length': String(req.body.length) } : {}),
        },
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
    const qs = canonicalQuery(req.query);
    const send = this.url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const r = send(
        {
          protocol: this.url.protocol,
          hostname: this.url.hostname.replace(/^\[|\]$/g, ''),
          port: this.url.port || undefined,
          method: req.method,
          path: qs ? `${path}?${qs}` : path,
          headers: signed.headers,
          timeout: this.timeoutMs,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status < 300) {
            resolve({ status, headers: res.headers, body: res });
            return;
          }
          readLimited(res, MAX_ERROR_BODY).then(
            (xml) => {
              const code = /<Code>([^<]{1,100})<\/Code>/.exec(xml?.toString('utf8') ?? '')?.[1];
              reject(new S3Error(status, code ?? (status === 404 ? 'NotFound' : `HTTP${status}`)));
            },
            () => reject(new S3Error(status, `HTTP${status}`)),
          );
        },
      );
      r.on('timeout', () => r.destroy(new Error('S3 timeout')));
      r.on('error', reject);
      r.end(req.body);
    });
  }

  /** Seperti `request`, lalu isi respons (kecil: kosong atau XML) dibaca utuh; lebih dari `maxBytes` → galat. */
  async send(
    req: S3Request,
    maxBytes = 1024 * 1024,
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
    const res = await this.request(req);
    const body = await readLimited(res.body, maxBytes);
    if (!body) throw new Error('Respons S3 terlalu besar');
    return { status: res.status, headers: res.headers, body };
  }
}
