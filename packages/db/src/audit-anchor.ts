import {
  AUDIT_VERIFY_MAX_ISSUES,
  type AuditVerifyIssueCode,
  type AuditVerifyMode,
  newId,
} from '@simrs/shared';
import {
  type AuditAnchorDocument,
  auditAnchorKeyId,
  auditAnchorObjectKey,
  createAuditAnchorDocument,
  verifyAuditAnchor,
} from '@simrs/shared/node';
import type { TenantTx } from './client';

/**
 * P04 · Jangkar hash audit dan pemeriksaan berbasis titik periksa (ADR-0072). Semua fungsi berjalan di dalam
 * `withTenant` (RLS); kunci HMAC dipegang aplikasi, tidak pernah masuk ke database.
 */

export interface AuditAnchorRow {
  seq: bigint;
  hash: string;
  anchoredAt: Date;
  keyId: string;
  hmac: string;
  objectKey: string | null;
  source: string;
  /** hash entri audit di seq yang sama sekarang; null = entri itu tidak ada lagi. */
  chainHash: string | null;
}

export interface AuditChainSegment {
  checked: number;
  firstBrokenSeq: bigint | null;
  /** Entri terakhir yang lolos pemeriksaan (kepala rantai bila utuh). */
  lastSeq: bigint | null;
  lastHash: string | null;
}

export interface AuditTrailIssue {
  code: AuditVerifyIssueCode;
  seq: bigint | null;
  anchoredAt: Date | null;
}

export interface AuditTrailVerification {
  mode: AuditVerifyMode;
  intact: boolean;
  checked: number;
  firstBrokenSeq: bigint | null;
  head: { seq: bigint; hash: string } | null;
  /** Entri terakhir yang lolos pemeriksaan hash (null bila rantai kosong atau rusak sejak titik mulai). */
  verifiedHead: { seq: bigint; hash: string } | null;
  checkpoint: { seq: bigint; hash: string; anchoredAt: Date } | null;
  anchors: {
    total: number;
    verified: number;
    keyConfigured: boolean;
    latestSeq: bigint | null;
    /** seq jangkar bertanda tangan sah terbesar (jangkar palsu tidak dihitung). */
    latestValidSeq: bigint | null;
  };
  issues: AuditTrailIssue[];
  issueCount: number;
}

/** Semua jangkar tenant aktif (urut seq) beserta hash entri audit di seq yang sama saat ini. */
export function listAuditAnchors(tx: TenantTx): Promise<AuditAnchorRow[]> {
  return tx.$queryRaw<AuditAnchorRow[]>`
    SELECT a.seq, a.hash, a.anchored_at AS "anchoredAt", a.key_id AS "keyId", a.hmac,
           a.object_key AS "objectKey", a.source, e.hash AS "chainHash"
    FROM audit_anchors a
    LEFT JOIN audit_events e ON e.tenant_id = a.tenant_id AND e.seq = a.seq
    ORDER BY a.seq`;
}

/**
 * Periksa rantai mulai dari titik periksa `(seq, hash)`, atau seluruh rantai bila `from` null. Baris titik periksa
 * ikut dihitung ulang hash-nya.
 */
export async function verifyAuditChainFrom(
  tx: TenantTx,
  from: { seq: bigint; hash: string } | null,
): Promise<AuditChainSegment> {
  const rows = await tx.$queryRaw<
    Array<{
      checked: bigint;
      first_broken_seq: bigint | null;
      last_seq: bigint | null;
      last_hash: string | null;
    }>
  >`SELECT checked, first_broken_seq, last_seq, last_hash
    FROM app_verify_audit_chain_from(${from?.seq ?? null}::bigint, ${from?.hash ?? null}::text)`;
  const r = rows[0];
  return {
    checked: Number(r?.checked ?? 0),
    firstBrokenSeq: r?.first_broken_seq ?? null,
    lastSeq: r?.last_seq ?? null,
    lastHash: r?.last_hash ?? null,
  };
}

/** Kepala rantai audit tenant aktif (entri seq terbesar). */
export async function auditChainHead(tx: TenantTx): Promise<{ seq: bigint; hash: string } | null> {
  const rows = await tx.$queryRaw<Array<{ seq: bigint; hash: string }>>`
    SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1`;
  return rows[0] ?? null;
}

const anchorFields = (tenantId: string, a: { seq: bigint; hash: string; anchoredAt: Date }) => ({
  tenantId,
  seq: a.seq.toString(),
  hash: a.hash,
  anchoredAt: a.anchoredAt.toISOString(),
});

/**
 * Pemeriksaan keutuhan jejak audit tenant aktif (ADR-0072).
 *
 * 1. Setiap jangkar diperiksa tanda tangannya (kunci HMAC dari env) lalu dicocokkan dengan entri di seq-nya:
 *    entri hilang di atas kepala rantai = `TRUNCATION_DETECTED`; entri ada tetapi hash lain = `ANCHOR_MISMATCH`.
 *    Ini O(jumlah jangkar), bukan O(jumlah entri), dan menangkap penulisan ulang rantai yang konsisten.
 * 2. `checkpoint`: hash dihitung ulang hanya sejak jangkar sah terakhir yang cocok dengan rantai. `full`: seluruh
 *    rantai (menangkap juga perubahan mentah sebelum titik periksa). Tanpa kunci: selalu `full`, jangkar dilewati.
 */
export async function verifyAuditTrail(
  tx: TenantTx,
  opts: { tenantId: string; anchorKeyB64?: string | null; mode: AuditVerifyMode },
): Promise<AuditTrailVerification> {
  const key = opts.anchorKeyB64 || null;
  const keyId = key ? auditAnchorKeyId(key) : null;
  const anchors = await listAuditAnchors(tx);
  const head = await auditChainHead(tx);

  const issues: AuditTrailIssue[] = [];
  const valid: AuditAnchorRow[] = [];
  if (key) {
    for (const a of anchors) {
      if (a.keyId !== keyId) {
        issues.push({ code: 'ANCHOR_KEY_UNKNOWN', seq: a.seq, anchoredAt: a.anchoredAt });
      } else if (!verifyAuditAnchor(anchorFields(opts.tenantId, a), a.hmac, key)) {
        issues.push({ code: 'ANCHOR_TAMPERED', seq: a.seq, anchoredAt: a.anchoredAt });
      } else {
        valid.push(a);
      }
    }
  }
  let checkpoint: AuditAnchorRow | null = null;
  for (const a of valid) {
    if (a.chainHash === a.hash) {
      checkpoint = a;
    } else if (a.chainHash === null && (head === null || head.seq < a.seq)) {
      issues.push({ code: 'TRUNCATION_DETECTED', seq: a.seq, anchoredAt: a.anchoredAt });
    } else {
      issues.push({ code: 'ANCHOR_MISMATCH', seq: a.seq, anchoredAt: a.anchoredAt });
    }
  }

  const mode: AuditVerifyMode = key ? opts.mode : 'full';
  const start = mode === 'checkpoint' && checkpoint ? { seq: checkpoint.seq, hash: checkpoint.hash } : null;
  const segment = await verifyAuditChainFrom(tx, start);
  if (segment.firstBrokenSeq !== null) {
    issues.push({ code: 'CHAIN_BROKEN', seq: segment.firstBrokenSeq, anchoredAt: null });
  }
  issues.sort((x, y) => ((x.seq ?? 0n) < (y.seq ?? 0n) ? -1 : (x.seq ?? 0n) > (y.seq ?? 0n) ? 1 : 0));

  return {
    mode,
    intact: issues.length === 0,
    checked: segment.checked,
    firstBrokenSeq: segment.firstBrokenSeq,
    head,
    verifiedHead:
      segment.lastSeq !== null && segment.lastHash !== null
        ? { seq: segment.lastSeq, hash: segment.lastHash }
        : null,
    checkpoint: start && checkpoint ? { ...start, anchoredAt: checkpoint.anchoredAt } : null,
    anchors: {
      total: anchors.length,
      verified: valid.length,
      keyConfigured: key !== null,
      latestSeq: anchors.at(-1)?.seq ?? null,
      latestValidSeq: valid.at(-1)?.seq ?? null,
    },
    issues: issues.slice(0, AUDIT_VERIFY_MAX_ISSUES),
    issueCount: issues.length,
  };
}

/** Jam database (sumber waktu tunggal, sama dengan trigger audit), dibulatkan ke milidetik. */
export async function databaseNow(tx: TenantTx): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
  if (!row) throw new Error('clock_timestamp() tidak mengembalikan baris');
  return row.now;
}

export interface PreparedAuditAnchor {
  verification: AuditTrailVerification;
  /** Dokumen jangkar baru untuk kepala yang terverifikasi; null = tidak perlu/tidak boleh menjangkar. */
  document: AuditAnchorDocument | null;
  /** Alasan bila `document` null. */
  skipped: 'empty' | 'unchanged' | 'chain_broken' | null;
}

/**
 * Langkah 1 job jangkar: periksa rantai sejak titik periksa terakhir, lalu tanda tangani kepala yang BARU SAJA
 * diperiksa (bukan kepala yang dibaca terpisah). Rantai rusak (`CHAIN_BROKEN`) tidak pernah dijangkar, agar
 * titik periksa tidak melompati baris rusak. Temuan jangkar lama (dipotong/dirusak) tetap tercatat permanen di
 * jangkar lama, jadi kepala baru tetap dijangkar untuk melindungi entri sesudah insiden.
 */
export async function prepareAuditAnchor(
  tx: TenantTx,
  opts: { tenantId: string; anchorKeyB64: string },
): Promise<PreparedAuditAnchor> {
  const verification = await verifyAuditTrail(tx, {
    tenantId: opts.tenantId,
    anchorKeyB64: opts.anchorKeyB64,
    mode: 'checkpoint',
  });
  if (verification.firstBrokenSeq !== null) {
    return { verification, document: null, skipped: 'chain_broken' };
  }
  // Kepala terverifikasi = baris terakhir yang diperiksa fungsi rantai (snapshot yang sama dengan pemeriksaan).
  const head = verification.verifiedHead;
  if (!head) return { verification, document: null, skipped: 'empty' };
  // Hanya maju melewati jangkar sah terbesar; jangkar palsu bernomor besar tidak bisa menghentikan penjangkaran.
  const latest = verification.anchors.latestValidSeq;
  if (latest !== null && head.seq <= latest) return { verification, document: null, skipped: 'unchanged' };
  const anchoredAt = await databaseNow(tx);
  const document = createAuditAnchorDocument(
    anchorFields(opts.tenantId, { ...head, anchoredAt }),
    opts.anchorKeyB64,
  );
  return { verification, document, skipped: null };
}

/**
 * Langkah 3 job jangkar: catat jangkar (setelah objek WORM tersimpan). Idempoten per (tenant, seq): sudah ada →
 * `false`. `source = worm` untuk jangkar yang dipulihkan dari bucket karena barisnya hilang dari database.
 */
export async function recordAuditAnchor(
  tx: TenantTx,
  doc: AuditAnchorDocument,
  opts: { objectKey: string | null; source?: 'job' | 'worm' },
): Promise<boolean> {
  if (opts.objectKey !== null && opts.objectKey !== auditAnchorObjectKey(doc.tenantId, doc.seq)) {
    throw new Error('Kunci objek jangkar tidak sesuai seq');
  }
  const res = await tx.auditAnchor.createMany({
    data: [
      {
        id: newId(),
        tenantId: doc.tenantId,
        seq: BigInt(doc.seq),
        hash: doc.hash,
        anchoredAt: new Date(doc.anchoredAt),
        keyId: doc.keyId,
        hmac: doc.hmac,
        objectKey: opts.objectKey,
        source: opts.source ?? 'job',
      },
    ],
    skipDuplicates: true,
  });
  return res.count === 1;
}

/** Jangkar sah terakhir di database (kunci objeknya = titik mulai rekonsiliasi dengan bucket WORM). */
export async function latestValidAuditAnchor(
  tx: TenantTx,
  opts: { tenantId: string; anchorKeyB64: string },
): Promise<AuditAnchorRow | null> {
  const keyId = auditAnchorKeyId(opts.anchorKeyB64);
  const rows = await listAuditAnchors(tx);
  for (let i = rows.length - 1; i >= 0; i--) {
    const a = rows[i] as AuditAnchorRow;
    if (a.keyId === keyId && verifyAuditAnchor(anchorFields(opts.tenantId, a), a.hmac, opts.anchorKeyB64)) {
      return a;
    }
  }
  return null;
}
