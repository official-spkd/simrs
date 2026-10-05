import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { frontOfficeError, idempotencyKeySchema, newId } from '@simrs/shared';
import { TenantDb } from '../infra/tenant-db';

/** JSON kanonis (kunci objek terurut) agar urutan field tidak mengubah sidik permintaan. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface IdempotencyClaim {
  scope: string;
  key: string;
  hash: string;
  /** Sumber hasil permintaan sebelumnya dengan kunci + isi yang sama (ulangi hasilnya), atau null (kerjakan). */
  existingResourceId: string | null;
}

/**
 * Header `Idempotency-Key` (UUID) untuk tindakan yang tidak boleh terjadi dua kali (registrasi; kelak check-in
 * anjungan). Dikerjakan di transaksi permintaan:
 * 1. `claim` mengunci kunci itu (advisory lock transaksi, tenant × lingkup × kunci) sehingga permintaan serentak
 *    dengan kunci sama menunggu yang pertama selesai, lalu mencari hasil sebelumnya:
 *    - ada + sidik isi sama → kembalikan id sumbernya (pemanggil menyusun ulang respons yang sama);
 *    - ada + sidik berbeda (isi lain atau pengguna lain) → 409 `IDEMPOTENCY_KEY_REUSED`;
 * 2. `record` menyimpan hasil baru di transaksi yang sama (batal bersama datanya).
 * Tanpa header / bukan UUID → 400 `IDEMPOTENCY_KEY_REQUIRED`.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly db: TenantDb) {}

  async claim(scope: string, rawKey: unknown, body: unknown): Promise<IdempotencyClaim> {
    const parsed = idempotencyKeySchema.safeParse(
      typeof rawKey === 'string' ? rawKey.trim().toLowerCase() : rawKey,
    );
    if (!parsed.success) {
      throw frontOfficeError(
        'IDEMPOTENCY_KEY_REQUIRED',
        undefined,
        rawKey === undefined || rawKey === ''
          ? undefined
          : 'Header Idempotency-Key harus UUID (buat sekali per tindakan, kirim ulang dengan nilai yang sama)',
      );
    }
    const key = parsed.data;
    const tenantId = this.db.tenantId();
    const hash = createHash('sha256')
      .update(canonical({ actor: this.db.actorUserId(), body }))
      .digest('hex');
    const tx = this.db.tx();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${scope}:${key}`}, 0))`;
    const existing = await tx.idempotencyKey.findUnique({
      where: { tenantId_scope_key: { tenantId, scope, key } },
      select: { requestHash: true, resourceId: true },
    });
    if (existing && existing.requestHash !== hash) throw frontOfficeError('IDEMPOTENCY_KEY_REUSED');
    return { scope, key, hash, existingResourceId: existing?.resourceId ?? null };
  }

  async record(claim: IdempotencyClaim, resourceType: string, resourceId: string): Promise<void> {
    await this.db.tx().idempotencyKey.create({
      data: {
        id: newId(),
        tenantId: this.db.tenantId(),
        scope: claim.scope,
        key: claim.key,
        requestHash: claim.hash,
        actorUserId: this.db.actorUserId(),
        resourceType,
        resourceId,
      },
    });
  }
}
