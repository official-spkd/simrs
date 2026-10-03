import { PrismaPg } from '@prisma/adapter-pg';
import { AppError, isUuid } from '@simrs/shared';
import { Prisma, PrismaClient } from './generated/prisma/client';

export { Prisma, PrismaClient };

/** Klien transaksi yang dipakai di dalam `withTenant`. */
export type TenantTx = Prisma.TransactionClient;

export interface CreateClientOptions {
  connectionString: string;
  /** Ukuran pool koneksi pg. */
  max?: number;
}

export function createPrismaClient({ connectionString, max = 10 }: CreateClientOptions): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}

/**
 * Jalankan `fn` dalam satu transaksi dengan `app.tenant_id` disetel (SET LOCAL).
 * Semua query di dalamnya tunduk RLS; di luar `withTenant` query ke tabel domain gagal dengan TENANT_REQUIRED.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new AppError('TENANT_REQUIRED', 'Konteks tenant tidak valid', 400);
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 15_000 },
  );
}

/** ID tenant aktif lewat fungsi SECURITY DEFINER sempit (ADR-0008). Untuk worker lintas tenant. */
export async function listActiveTenantIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT app_active_tenant_ids() AS id`;
  return rows.map((r) => r.id);
}

/** Galat Postgres dari `app_current_tenant()` saat konteks belum disetel. */
export function isTenantRequiredError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('TENANT_REQUIRED');
}
