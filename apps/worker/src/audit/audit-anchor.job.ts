import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  createPrismaClient,
  latestValidAuditAnchor,
  listActiveTenantIds,
  prepareAuditAnchor,
  type PrismaClient,
  recordAuditAnchor,
  withTenant,
} from '@simrs/db';
import {
  type AuditAnchorDocument,
  auditAnchorKeyId,
  auditAnchorObjectKey,
  verifyAuditAnchor,
} from '@simrs/shared/node';
import { WORKER_ENV, type WorkerEnv } from '../config/env';
import { AUDIT_ANCHOR_STORE, type AuditAnchorStore } from './anchor-store';

export interface TenantAnchorResult {
  tenantId: string;
  /** seq yang baru dijangkar, atau null. */
  anchoredSeq: string | null;
  skipped: 'empty' | 'unchanged' | 'chain_broken' | null;
  /** Jangkar yang dipulihkan dari bucket WORM ke database (barisnya hilang). */
  restored: number;
  /** Objek di bucket yang isinya tidak sah (tanda tangan/format salah). */
  invalidWorm: number;
  /** Kode temuan pemeriksaan keutuhan (kosong = utuh). */
  issues: string[];
}

export interface AnchorRunSummary {
  tenants: number;
  anchored: number;
  failed: number;
  results: TenantAnchorResult[];
}

/** Batas waktu transaksi pemeriksaan: run pertama pada jejak besar menghitung ulang seluruh rantai sekali. */
const VERIFY_TIMEOUT_MS = 10 * 60_000;

/**
 * P04 · Job jangkar hash audit, setiap jam (ADR-0072). Per tenant aktif (RLS tetap berlaku, ADR-0008):
 * 1. rekonsiliasi: jangkar di bucket WORM sesudah jangkar sah terakhir di database dicatat ulang (`source = worm`),
 *    sehingga menghapus baris jangkar di database tidak menyembunyikan pemotongan rantai;
 * 2. periksa rantai sejak titik periksa terakhir dan tanda tangani kepala yang terverifikasi;
 * 3. tulis objek WORM (di LUAR transaksi database; `If-None-Match` + Object Lock);
 * 4. catat jangkar di `audit_anchors` (idempoten per seq).
 * Kunci HMAC tidak dipasang → job tidak berjalan (hanya di luar produksi; env produksi mewajibkannya).
 */
@Injectable()
export class AuditAnchorJob implements OnModuleDestroy {
  private readonly logger = new Logger(AuditAnchorJob.name);
  readonly prisma: PrismaClient;

  constructor(
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(AUDIT_ANCHOR_STORE) private readonly store: AuditAnchorStore | null,
  ) {
    this.prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  }

  get enabled(): boolean {
    return Boolean(this.env.AUDIT_ANCHOR_KEY);
  }

  async runOnce(opts: { tenantIds?: string[] } = {}): Promise<AnchorRunSummary> {
    const key = this.env.AUDIT_ANCHOR_KEY;
    if (!key) return { tenants: 0, anchored: 0, failed: 0, results: [] };
    const tenantIds = opts.tenantIds ?? (await listActiveTenantIds(this.prisma));
    const summary: AnchorRunSummary = { tenants: tenantIds.length, anchored: 0, failed: 0, results: [] };
    for (const tenantId of tenantIds) {
      try {
        const r = await this.anchorTenant(tenantId, key);
        summary.results.push(r);
        if (r.anchoredSeq) summary.anchored += 1;
        if (r.issues.length > 0 || r.invalidWorm > 0) {
          // Tanpa PHI: hanya id tenant, kode temuan, dan jumlah.
          this.logger.error(
            `jejak audit tenant ${tenantId} TIDAK UTUH: ${r.issues.join(', ') || '-'}; objek WORM tidak sah ${r.invalidWorm}`,
          );
        }
      } catch (err) {
        summary.failed += 1;
        this.logger.error(
          `jangkar audit tenant ${tenantId} gagal: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    return summary;
  }

  async anchorTenant(tenantId: string, key: string): Promise<TenantAnchorResult> {
    const { restored, invalidWorm } = await this.reconcile(tenantId, key);
    const prepared = await withTenant(
      this.prisma,
      tenantId,
      (tx) => prepareAuditAnchor(tx, { tenantId, anchorKeyB64: key }),
      { timeoutMs: VERIFY_TIMEOUT_MS },
    );
    const result: TenantAnchorResult = {
      tenantId,
      anchoredSeq: null,
      skipped: prepared.skipped,
      restored,
      invalidWorm,
      issues: [...new Set(prepared.verification.issues.map((i) => i.code))],
    };
    if (!prepared.document) return result;

    let doc: AuditAnchorDocument = prepared.document;
    let objectKey: string | null = null;
    if (this.store) {
      const put = await this.store.put(doc);
      if (put.status === 'exists') {
        // Run sebelumnya menulis objek lalu gagal sebelum mencatat ke database: pakai isi yang sudah terkunci.
        const stored = put.stored;
        if (!stored || stored.hash !== doc.hash || !this.validDocument(stored, tenantId, key)) {
          throw new Error(`objek WORM seq ${doc.seq} sudah ada dengan isi lain`);
        }
        doc = stored;
      }
      objectKey = put.key;
    }
    await withTenant(this.prisma, tenantId, (tx) => recordAuditAnchor(tx, doc, { objectKey }));
    result.anchoredSeq = doc.seq;
    return result;
  }

  /** Jangkar di bucket sesudah jangkar sah terakhir di database → catat ulang (idempoten). */
  private async reconcile(tenantId: string, key: string): Promise<{ restored: number; invalidWorm: number }> {
    if (!this.store) return { restored: 0, invalidWorm: 0 };
    const latest = await withTenant(this.prisma, tenantId, (tx) =>
      latestValidAuditAnchor(tx, { tenantId, anchorKeyB64: key }),
    );
    const afterKey = latest ? auditAnchorObjectKey(tenantId, latest.seq) : null;
    let restored = 0;
    let invalidWorm = 0;
    for (const objectKey of await this.store.listAfter(tenantId, afterKey)) {
      const doc = await this.store.get(objectKey);
      if (
        !doc ||
        !this.validDocument(doc, tenantId, key) ||
        auditAnchorObjectKey(tenantId, doc.seq) !== objectKey
      ) {
        invalidWorm += 1;
        continue;
      }
      const inserted = await withTenant(this.prisma, tenantId, (tx) =>
        recordAuditAnchor(tx, doc, { objectKey, source: 'worm' }),
      );
      if (inserted) restored += 1;
    }
    return { restored, invalidWorm };
  }

  private validDocument(doc: AuditAnchorDocument, tenantId: string, key: string): boolean {
    return (
      doc.tenantId === tenantId &&
      doc.keyId === auditAnchorKeyId(key) &&
      verifyAuditAnchor(doc, doc.hmac, key)
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
