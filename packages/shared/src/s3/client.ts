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

/** Satu versi objek (atau penanda hapus) dari ListObjectVersions. */
export interface S3ObjectVersion {
  key: string;
  versionId: string;
  isLatest: boolean;
  deleteMarker: boolean;
}

/**
 * Header `Content-MD5` (base64 MD5 isi). S3 mewajibkannya (atau checksum lain) untuk PutObject dengan retensi Object
 * Lock; MinIO tidak, tetapi mengirimnya membuat perilaku sama di kedua penyedia.
 */
export function contentMd5(body: Buffer): string {
  return createHash('md5').update(body).digest('base64');
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

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e] ?? '');

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

  /**
   * ListObjectsV2 seluruh halaman di bawah `prefix` (kunci + ukuran), urut leksikal seperti S3. Dipakai backup
   * (ADR-0071) untuk objek jangkar audit dan memeriksa bucket uji.
   */
  async listObjects(bucket: string, prefix = ''): Promise<Array<{ key: string; size: number }>> {
    const out: Array<{ key: string; size: number }> = [];
    let token: string | undefined;
    for (;;) {
      const query: Record<string, string> = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const res = await this.send({ method: 'GET', bucket, query }, 8 * 1024 * 1024);
      const xml = res.body.toString('utf8');
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]*)<\/Key>/.exec(m[1] ?? '')?.[1];
        const size = /<Size>(\d+)<\/Size>/.exec(m[1] ?? '')?.[1];
        if (key !== undefined) out.push({ key: decodeXml(key), size: Number(size ?? 0) });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
      if (!truncated || !token) return out;
      token = decodeXml(token);
    }
  }

  /**
   * ListObjectVersions seluruh halaman di bawah `prefix`, sesudah kunci `keyMarker` (eksklusif): setiap versi objek
   * dan penanda hapus, urut kunci lalu terbaru dulu (urutan S3). Berbeda dengan `listObjects`, objek yang
   * disembunyikan penanda hapus tetap terlihat; dipakai bucket WORM jangkar audit (ADR-0072) untuk membaca versi
   * PERTAMA objek, yang tidak bisa diubah pemegang kredensial bucket.
   */
  async listObjectVersions(
    bucket: string,
    prefix = '',
    opts: { keyMarker?: string } = {},
  ): Promise<S3ObjectVersion[]> {
    const out: S3ObjectVersion[] = [];
    let marker: { key: string; versionId?: string } | undefined = opts.keyMarker
      ? { key: opts.keyMarker }
      : undefined;
    for (;;) {
      const query: Record<string, string> = { versions: '', prefix };
      if (marker) {
        query['key-marker'] = marker.key;
        if (marker.versionId) query['version-id-marker'] = marker.versionId;
      }
      const res = await this.send({ method: 'GET', bucket, query }, 8 * 1024 * 1024);
      const xml = res.body.toString('utf8');
      for (const m of xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
        const inner = m[2] ?? '';
        const key = /<Key>([^<]*)<\/Key>/.exec(inner)?.[1];
        const versionId = /<VersionId>([^<]*)<\/VersionId>/.exec(inner)?.[1];
        if (key === undefined || versionId === undefined) continue;
        out.push({
          key: decodeXml(key),
          versionId: decodeXml(versionId),
          isLatest: /<IsLatest>true<\/IsLatest>/.test(inner),
          deleteMarker: m[1] === 'DeleteMarker',
        });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const nextKey = /<NextKeyMarker>([^<]*)<\/NextKeyMarker>/.exec(xml)?.[1];
      const nextVersion = /<NextVersionIdMarker>([^<]*)<\/NextVersionIdMarker>/.exec(xml)?.[1];
      if (!truncated || nextKey === undefined) return out;
      marker = {
        key: decodeXml(nextKey),
        versionId: nextVersion === undefined ? undefined : decodeXml(nextVersion),
      };
    }
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
