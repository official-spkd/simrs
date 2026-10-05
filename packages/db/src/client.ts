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

/**
 * Klien Prisma 7 + driver adapter `pg`. Zona waktu sesi DIPAKSA UTC: adapter menulis `Date` sebagai waktu UTC
 * tanpa zona (ditafsirkan Postgres dalam zona sesi) dan membuang offset saat membaca `timestamptz`. Dengan zona
 * sesi selain UTC (mis. server `timezone = Asia/Jakarta`), tanggal tersimpan bergeser (−7 jam) dan waktu buatan
 * database (`now()`, trigger audit) terbaca bergeser (+7 jam); kedaluwarsa sesi pun ikut salah. Dijaga tes
 * `packages/db/test/time-zone.test.ts`. Tampilan WIB tetap urusan aplikasi (`@simrs/shared` datetime).
 */
export function createPrismaClient({ connectionString, max = 10 }: CreateClientOptions): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, options: '-c TimeZone=UTC' }) });
}

/**
 * Jalankan `fn` dalam satu transaksi dengan `app.tenant_id` disetel (SET LOCAL).
 * Semua query di dalamnya tunduk RLS; di luar `withTenant` query ke tabel domain gagal dengan TENANT_REQUIRED.
 * `maxWaitMs`: batas tunggu koneksi untuk memulai transaksi (bawaan Prisma 2 dtk, cocok untuk API: gagal cepat saat
 * pool penuh); alat uji di mesin sibuk boleh menunggu lebih lama.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { timeoutMs?: number; maxWaitMs?: number },
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new AppError('TENANT_REQUIRED', 'Konteks tenant tidak valid', 400);
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    {
      timeout: options?.timeoutMs ?? 15_000,
      ...(options?.maxWaitMs === undefined ? {} : { maxWait: options.maxWaitMs }),
    },
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

export interface AuditChainResult {
  /** Jumlah baris yang diperiksa (berhenti di baris rusak pertama). */
  checked: number;
  /** seq pertama yang rusak, atau null bila rantai utuh. */
  firstBrokenSeq: bigint | null;
}

/** Verifikasi hash berantai audit tenant aktif (harus di dalam `withTenant`). */
export async function verifyAuditChain(tx: TenantTx): Promise<AuditChainResult> {
  const rows = await tx.$queryRaw<Array<{ checked: bigint; first_broken_seq: bigint | null }>>`
    SELECT checked, first_broken_seq FROM app_verify_audit_chain()`;
  const row = rows[0];
  return { checked: Number(row?.checked ?? 0), firstBrokenSeq: row?.first_broken_seq ?? null };
}

export interface KnownDbError {
  /** Kode Prisma, mis. P2002 (unik), P2003 (FK), P2025 (tidak ditemukan). */
  code: string;
  /** Nama kolom/constraint yang terlibat (bukan nilai). */
  fields?: string[];
}

/**
 * Kode stabil dari `RAISE EXCEPTION 'KODE: …' USING ERRCODE = 'P0001'` di trigger/fungsi (mis. `RECORD_LOCKED`,
 * `CLINICAL_CHAIN`, `WRISTBAND_MISMATCH`), atau null. Hanya awalan huruf besar yang diambil; pesan (bisa memuat nilai)
 * tidak pernah diteruskan.
 */
export function raisedDbCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const cause = (
    err as {
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; originalMessage?: unknown } } };
    }
  ).meta?.driverAdapterError?.cause;
  const message =
    cause?.originalCode === 'P0001' && typeof cause.originalMessage === 'string'
      ? cause.originalMessage
      : err.message;
  const m = /(?:^|\s|")([A-Z][A-Z0-9_]{2,40}):\s/.exec(message);
  return m ? (m[1] as string) : null;
}

/** Nama indeks/constraint unik yang dilanggar (P2002), bila adapter menyertakannya; tanpa nilai. */
export function uniqueViolationTarget(err: unknown): string {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return '';
  const meta = err.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
      }
    | undefined;
  const parts: unknown[] = [
    meta?.target,
    meta?.driverAdapterError?.cause?.constraint?.index,
    meta?.driverAdapterError?.cause?.constraint?.fields,
  ];
  return parts
    .flat()
    .filter((p): p is string => typeof p === 'string')
    .join(',');
}

/** Ringkas galat database yang dikenal tanpa membawa pesan/nilai (bisa memuat PHI). */
export function knownDbError(err: unknown): KnownDbError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return {
    code: err.code,
    fields: Array.isArray(target) ? target.filter((t): t is string => typeof t === 'string') : undefined,
  };
}

/** P02 · Tenant dari kode RS (login lokal/staging). Fungsi SECURITY DEFINER sempit: hanya ID tenant aktif. */
export async function resolveTenantByCode(prisma: PrismaClient, code: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string | null }>
  >`SELECT app_resolve_tenant_by_code(${code}) AS id`;
  return rows[0]?.id ?? null;
}

/** P02 · Tenant dari host/subdomain (login produksi). */
export async function resolveTenantByHost(prisma: PrismaClient, host: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string | null }>
  >`SELECT app_resolve_tenant_by_host(${host}) AS id`;
  return rows[0]?.id ?? null;
}
