import {
  type AuditAnchorDocument,
  auditAnchorObjectKey,
  auditAnchorObjectPrefix,
  contentMd5,
  parseAuditAnchorDocument,
  S3Client,
  S3Error,
} from '@simrs/shared/node';

/**
 * Penyimpanan WORM jangkar audit (ADR-0072). Satu objek per (tenant, seq), ditulis sekali:
 * - `If-None-Match: *` → objek yang sudah ada tidak pernah ditimpa oleh job (job yang diulang membaca yang ada);
 * - Object Lock mode COMPLIANCE + `retain-until` → versi objek tidak bisa dihapus/ditimpa siapa pun (termasuk root)
 *   sampai masa kunci habis. Bucket wajib dibuat dengan object lock aktif (versi otomatis aktif).
 * Memakai klien S3 bersama `@simrs/shared/node` (SigV4, juga dipakai dokumen P08 dan backup).
 */
export interface AuditAnchorStore {
  /** `created` = objek baru; `exists` = sudah ada (isi yang tersimpan dikembalikan apa adanya, bisa null bila rusak). */
  put(
    doc: AuditAnchorDocument,
  ): Promise<{ status: 'created' | 'exists'; key: string; stored: AuditAnchorDocument | null }>;
  /** Jangkar di bucket untuk tenant ini sesudah `afterKey` (urut seq naik). */
  listAfter(tenantId: string, afterKey: string | null): Promise<string[]>;
  get(key: string): Promise<AuditAnchorDocument | null>;
  /** Gagal bila bucket tidak ada atau object lock tidak aktif (dipanggil saat start). */
  assertWorm(): Promise<void>;
}

export interface S3AnchorStoreConfig {
  bucket: string;
  /** Masa kunci objek sejak ditulis (`AUDIT_ANCHOR_RETENTION_DAYS`; tes memakai detik). */
  retentionMs: number;
}

const DAY_MS = 86_400_000;

export class S3WormAnchorStore implements AuditAnchorStore {
  constructor(
    private readonly s3: S3Client,
    private readonly cfg: S3AnchorStoreConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async put(doc: AuditAnchorDocument) {
    const key = auditAnchorObjectKey(doc.tenantId, doc.seq);
    const body = Buffer.from(`${JSON.stringify(doc)}\n`);
    const retainUntil = new Date(this.now().getTime() + this.cfg.retentionMs);
    try {
      await this.s3.send({
        method: 'PUT',
        bucket: this.cfg.bucket,
        key,
        body,
        headers: {
          'content-type': 'application/json',
          // Object Lock mewajibkan Content-MD5 (atau checksum) pada PUT dengan retensi.
          'content-md5': contentMd5(body),
          'if-none-match': '*',
          'x-amz-object-lock-mode': 'COMPLIANCE',
          'x-amz-object-lock-retain-until-date': retainUntil.toISOString(),
        },
      });
      return { status: 'created' as const, key, stored: doc };
    } catch (err) {
      if (err instanceof S3Error && (err.status === 412 || err.code === 'PreconditionFailed')) {
        return { status: 'exists' as const, key, stored: await this.get(key) };
      }
      throw err;
    }
  }

  /**
   * Isi jangkar = versi PERTAMA objek. Pemegang kredensial bucket bisa menambah versi baru (isi palsu) atau penanda
   * hapus di atasnya, tetapi tidak bisa menghapus/mengubah versi pertama yang terkunci; job selalu menulis dengan
   * `If-None-Match`, jadi versi pertama adalah tulisan job.
   */
  async get(key: string): Promise<AuditAnchorDocument | null> {
    const first = (await this.versions(key, null)).filter((v) => v.key === key).at(-1);
    if (!first) return null;
    const res = await this.s3.send({
      method: 'GET',
      bucket: this.cfg.bucket,
      key,
      query: { versionId: first.versionId },
    });
    return parseAuditAnchorDocument(res.body);
  }

  /**
   * Kunci jangkar tenant sesudah `afterKey`, urut seq naik. Memakai daftar VERSI (bukan ListObjectsV2) agar objek
   * yang disembunyikan penanda hapus tetap terlihat.
   */
  async listAfter(tenantId: string, afterKey: string | null): Promise<string[]> {
    const keys = new Set(
      (await this.versions(auditAnchorObjectPrefix(tenantId), afterKey)).map((v) => v.key),
    );
    return [...keys].sort();
  }

  /** Versi objek (bukan penanda hapus) berawalan `prefix`; per kunci terbaru dulu (urutan S3). */
  private async versions(prefix: string, afterKey: string | null) {
    const all = await this.s3.listObjectVersions(
      this.cfg.bucket,
      prefix,
      afterKey ? { keyMarker: afterKey } : {},
    );
    return all.filter((v) => !v.deleteMarker && v.key.startsWith(prefix));
  }

  async assertWorm(): Promise<void> {
    const res = await this.s3.send({ method: 'GET', bucket: this.cfg.bucket, query: { 'object-lock': '' } });
    if (!/<ObjectLockEnabled>Enabled<\/ObjectLockEnabled>/.test(res.body.toString('utf8'))) {
      throw new Error('Bucket jangkar audit tanpa object lock (buat dengan mc mb --with-lock)');
    }
  }
}

export const AUDIT_ANCHOR_STORE = Symbol('AUDIT_ANCHOR_STORE');

/** Bucket WORM dari env, atau null bila `AUDIT_ANCHOR_BUCKET` kosong (lokal: jangkar hanya di database). */
export function createAuditAnchorStore(env: {
  AUDIT_ANCHOR_BUCKET?: string;
  AUDIT_ANCHOR_RETENTION_DAYS: number;
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
}): AuditAnchorStore | null {
  if (!env.AUDIT_ANCHOR_BUCKET || !env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  });
  return new S3WormAnchorStore(s3, {
    bucket: env.AUDIT_ANCHOR_BUCKET,
    retentionMs: env.AUDIT_ANCHOR_RETENTION_DAYS * DAY_MS,
  });
}
