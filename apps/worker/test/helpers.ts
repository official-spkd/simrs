/** Bantuan tes worker: tenant fiktif baru, env tes, modul Nest dengan peta operasi/job pengganti. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createPrismaClient, type PrismaClient, type TenantTx, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { PERIODIC_JOB_REGISTRY, type PeriodicJob } from '../src/jobs/periodic-jobs';
import { OUTBOX_OPERATION_REGISTRY, OUTBOX_OPERATIONS, type OutboxOperation } from '../src/outbox/operations';
import { WorkerModule } from '../src/worker.module';

export function loadTestEnvFile(): void {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
}

/** Env worker untuk tes: DB tes (role simrs_app), prefiks BullMQ unik (Redis dipakai bersama). */
export function testEnv(overrides: Record<string, string | undefined> = {}): WorkerEnv {
  return loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrls().app,
    OUTBOX_HTTP_TIMEOUT_MS: '2000',
    BULLMQ_PREFIX: `bull-test-${newId()}`,
    ...overrides,
  });
}

/** Modul worker dengan operasi uji ditambahkan ke peta asli (dan peta job pengganti bila diberikan). */
export async function testModule(
  env: WorkerEnv,
  opts: { operations?: Record<string, OutboxOperation>; jobs?: Record<string, PeriodicJob> } = {},
) {
  let builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(WORKER_ENV)
    .useValue(env)
    .overrideProvider(OUTBOX_OPERATION_REGISTRY)
    .useValue(new Map([...OUTBOX_OPERATIONS, ...Object.entries(opts.operations ?? {})]));
  if (opts.jobs) {
    builder = builder.overrideProvider(PERIODIC_JOB_REGISTRY).useValue(new Map(Object.entries(opts.jobs)));
  }
  return builder.compile();
}

/** Tenant fiktif baru (dibuat sebagai migrator, pemilik tabel `tenants`): pesan tes tidak bercampur. */
export async function freshTenant(label = 'Uji Worker'): Promise<string> {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  const id = newId();
  try {
    await withTenant(owner, id, (tx) =>
      tx.tenant.create({ data: { id, code: `TW${id.slice(-8).toUpperCase()}`, name: `RS Fiktif ${label}` } }),
    );
  } finally {
    await owner.$disconnect();
  }
  return id;
}

export function tenantDb(db: PrismaClient, tenantId: string) {
  return <R>(fn: (tx: TenantTx) => Promise<R>) => withTenant(db, tenantId, fn);
}
