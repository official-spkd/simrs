import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * P04 · Jangkar hash audit (ADR-0072). Kepala rantai audit satu tenant `{tenant, seq, hash, waktu}` ditandatangani
 * HMAC-SHA256 dengan kunci terpisah (`AUDIT_ANCHOR_KEY`), lalu disimpan di tabel `audit_anchors` dan bucket WORM.
 * Hash rantai sendiri tidak berkunci, jadi admin database bisa menulis ulang seluruh rantai secara konsisten atau
 * memotong ujungnya; jangkar berkunci yang disimpan di luar database membuat keduanya ketahuan.
 *
 * Kunci HMAC diturunkan per tenant (HKDF, seperti kunci kolom) sehingga server edge satu RS cukup memegang kunci
 * turunan tenantnya. Identitas kunci (`keyId`) disimpan bersama jangkar agar rotasi kunci bisa dibedakan dari
 * perusakan.
 */

export const AUDIT_ANCHOR_VERSION = 1;
const MESSAGE_PREFIX = 'simrs/audit-anchor/v1';

export interface AuditAnchorFields {
  tenantId: string;
  /** seq entri audit yang dijangkar (desimal). */
  seq: string;
  /** hash entri itu (hex SHA-256). */
  hash: string;
  /** Waktu jangkar dari jam database, ISO 8601 UTC dengan milidetik. */
  anchoredAt: string;
}

/** Isi objek WORM (JSON). Tanpa PHI: hanya id tenant, nomor urut, hash, waktu, dan tanda tangan. */
export interface AuditAnchorDocument extends AuditAnchorFields {
  v: typeof AUDIT_ANCHOR_VERSION;
  keyId: string;
  hmac: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

export const auditAnchorDocumentSchema = z.strictObject({
  v: z.literal(AUDIT_ANCHOR_VERSION),
  tenantId: z.uuid(),
  seq: z.string().regex(/^[1-9]\d{0,18}$/),
  hash: z.string().regex(HEX64),
  anchoredAt: z.iso.datetime(),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  hmac: z.string().regex(HEX64),
});

function masterKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('AUDIT_ANCHOR_KEY harus 32 byte (base64)');
  return key;
}

function tenantKey(keyB64: string, tenantId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey(keyB64), Buffer.from(tenantId), 'simrs:audit_anchor:v1', 32),
  );
}

/** Pesan kanonik yang ditandatangani: baris tetap, tidak ambigu (setiap bidang sudah tervalidasi formatnya). */
export function auditAnchorMessage(a: AuditAnchorFields): string {
  return [MESSAGE_PREFIX, a.tenantId, a.seq, a.hash, a.anchoredAt].join('\n');
}

/** Sidik kunci induk (16 hex). Tidak membocorkan kunci; membedakan "kunci lain" dari "isi dirusak". */
export function auditAnchorKeyId(keyB64: string): string {
  return createHash('sha256')
    .update('simrs:audit_anchor:key_id:v1\n')
    .update(masterKey(keyB64))
    .digest('hex')
    .slice(0, 16);
}

export function signAuditAnchor(a: AuditAnchorFields, keyB64: string): string {
  return createHmac('sha256', tenantKey(keyB64, a.tenantId))
    .update(auditAnchorMessage(a), 'utf8')
    .digest('hex');
}

/** Bandingkan HMAC dalam waktu konstan. Format salah = tidak sah (tidak melempar). */
export function verifyAuditAnchor(a: AuditAnchorFields, mac: string, keyB64: string): boolean {
  if (!HEX64.test(mac)) return false;
  return timingSafeEqual(Buffer.from(signAuditAnchor(a, keyB64), 'hex'), Buffer.from(mac, 'hex'));
}

/** Dokumen jangkar bertanda tangan untuk kepala rantai. */
export function createAuditAnchorDocument(a: AuditAnchorFields, keyB64: string): AuditAnchorDocument {
  return {
    v: AUDIT_ANCHOR_VERSION,
    ...a,
    keyId: auditAnchorKeyId(keyB64),
    hmac: signAuditAnchor(a, keyB64),
  };
}

/**
 * Kunci objek WORM: `audit-anchors/<tenant>/<seq 20 digit>.json`. seq diberi nol di depan agar urutan leksikal
 * (ListObjectsV2) sama dengan urutan rantai; satu seq = satu objek (tulis ulang ditolak `If-None-Match`).
 */
export function auditAnchorObjectKey(tenantId: string, seq: bigint | string): string {
  return `${auditAnchorObjectPrefix(tenantId)}${String(seq).padStart(20, '0')}.json`;
}

export function auditAnchorObjectPrefix(tenantId: string): string {
  return `audit-anchors/${z.uuid().parse(tenantId)}/`;
}

/** Baca isi objek WORM; bentuk salah = `null` (diperlakukan sebagai jangkar rusak oleh pemanggil). */
export function parseAuditAnchorDocument(body: Buffer | string): AuditAnchorDocument | null {
  try {
    const parsed = auditAnchorDocumentSchema.safeParse(JSON.parse(body.toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
