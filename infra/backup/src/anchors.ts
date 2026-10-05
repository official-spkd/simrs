/**
 * Pembanding independen untuk uji restore (ADR-0071 × ADR-0072): jangkar audit sah TERBARU yang dibuat sebelum
 * backup harus cocok dengan rantai hasil restore. Sumber utama bucket WORM (`AUDIT_ANCHOR_BUCKET`, di luar dump);
 * tanpa bucket, tabel `audit_anchors` hasil restore (kurang independen, dilaporkan). Dengan `AUDIT_ANCHOR_KEY`,
 * HMAC setiap jangkar diperiksa; jangkar palsu/kunci lain dilewati, bukan dipercaya.
 */
import {
  auditAnchorKeyId,
  auditAnchorObjectPrefix,
  parseAuditAnchorDocument,
  type S3Client,
  verifyAuditAnchor,
} from '@simrs/shared/node';
import type pg from 'pg';

export interface AnchorCandidate {
  tenantId: string;
  seq: string;
  hash: string;
  anchoredAt: string;
  keyId: string;
  hmac: string;
}

export type AnchorVerdict = 'ok' | 'after_backup' | 'key_unknown' | 'tampered';

/** Nilai satu jangkar terhadap waktu backup dan (bila ada) kunci HMAC. */
export function judgeAnchor(a: AnchorCandidate, backupTime: Date, key?: string): AnchorVerdict {
  if (new Date(a.anchoredAt).getTime() > backupTime.getTime()) return 'after_backup';
  if (!key) return 'ok';
  if (a.keyId !== auditAnchorKeyId(key)) return 'key_unknown';
  return verifyAuditAnchor(a, a.hmac, key) ? 'ok' : 'tampered';
}

export interface PickedAnchor {
  anchor: AnchorCandidate | null;
  /** Jangkar ≤ waktu backup yang ditolak (palsu/kunci lain) sebelum yang sah ditemukan. */
  rejected: number;
}

/** Kandidat diurutkan seq menurun; yang pertama sah dan ≤ waktu backup dipakai. */
export async function pickAnchor(
  candidates: AsyncIterable<AnchorCandidate> | Iterable<AnchorCandidate>,
  backupTime: Date,
  key?: string,
): Promise<PickedAnchor> {
  let rejected = 0;
  for await (const a of candidates) {
    const v = judgeAnchor(a, backupTime, key);
    if (v === 'ok') return { anchor: a, rejected };
    if (v !== 'after_backup') rejected += 1;
  }
  return { anchor: null, rejected };
}

/** Objek jangkar satu tenant di bucket WORM, seq menurun (kunci 20 digit → urutan leksikal = urutan seq). */
export async function* wormAnchors(
  s3: S3Client,
  bucket: string,
  tenantId: string,
): AsyncGenerator<AnchorCandidate> {
  const objects = await s3.listObjects(bucket, auditAnchorObjectPrefix(tenantId));
  const keys = objects.map((o) => o.key).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  for (const key of keys) {
    const res = await s3.send({ method: 'GET', bucket, key }, 64 * 1024);
    const doc = parseAuditAnchorDocument(res.body);
    if (!doc || doc.tenantId !== tenantId) continue;
    yield {
      tenantId,
      seq: doc.seq,
      hash: doc.hash,
      anchoredAt: doc.anchoredAt,
      keyId: doc.keyId,
      hmac: doc.hmac,
    };
  }
}

/** Jangkar satu tenant dari tabel `audit_anchors` (koneksi superuser ke DB hasil restore), seq menurun. */
export async function tableAnchors(client: pg.Client, tenantId: string): Promise<AnchorCandidate[]> {
  const exists = await client.query("SELECT to_regclass('public.audit_anchors') AS t");
  if (!exists.rows[0]?.t) return [];
  const r = await client.query<{
    seq: string;
    hash: string;
    anchored_at: Date;
    key_id: string;
    hmac: string;
  }>(
    'SELECT a.seq::text AS seq, a.hash, a.anchored_at, a.key_id, a.hmac FROM public.audit_anchors a WHERE a.tenant_id = $1 ORDER BY a.seq DESC',
    [tenantId],
  );
  return r.rows.map((x) => ({
    tenantId,
    seq: x.seq,
    hash: x.hash,
    anchoredAt: x.anchored_at.toISOString(),
    keyId: x.key_id,
    hmac: x.hmac,
  }));
}
