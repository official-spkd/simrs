/**
 * ADR-0104 · Job `board.signals-cleanup`: sinyal papan IGD/bed > 1 jam dihapus per batch lewat fungsi sempit
 * `app_purge_board_signals` (role aplikasi tanpa DELETE), hanya tenant aktif, sinyal baru tetap; fungsi menolak batch
 * di luar 1–5000 dan tidak pernah menghapus sinyal < 10 menit walau batasnya "sekarang". Data fiktif.
 */
import { createPrismaClient, type PrismaClient } from '@simrs/db';
import { newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOARD_SIGNAL_PURGE_BATCH, boardSignalsCleanupJob } from '../src/jobs/board-jobs';
import { PERIODIC_JOBS } from '../src/jobs/periodic-jobs';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv } from './helpers';

let db: PrismaClient;

beforeAll(() => {
  loadTestEnvFile();
  db = createPrismaClient({ connectionString: testEnv().DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await db?.$disconnect();
});

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

async function seed(tenantId: string, createdAt: Date[]): Promise<void> {
  await tenantDb(
    db,
    tenantId,
  )((tx) =>
    tx.boardSignal.createMany({
      data: createdAt.map((at) => ({
        id: newId(),
        tenantId,
        board: 'ed',
        source: 'triage',
        sourceId: newId(),
        encounterId: newId(),
        unitId: newId(),
        status: 'final',
        createdAt: at,
      })),
    }),
  );
}

const count = (tenantId: string) => tenantDb(db, tenantId)((tx) => tx.boardSignal.count());

describe('pembersih sinyal papan', () => {
  it('terdaftar di peta job berkala (tiap 15 menit)', () => {
    expect(PERIODIC_JOBS.get('board.signals-cleanup')).toBe(boardSignalsCleanupJob);
    expect(boardSignalsCleanupJob.schedule).toEqual({ everyMs: 15 * 60_000 });
  });

  it('menghapus sinyal > 1 jam dalam beberapa batch; sinyal baru dan tenant lain tetap', async () => {
    const now = new Date();
    const a = await freshTenant('Sinyal A');
    const b = await freshTenant('Sinyal B');
    const old = Array.from({ length: BOARD_SIGNAL_PURGE_BATCH + 5 }, (_, i) =>
      minutesAgo(now, 61 + (i % 50)),
    );
    await seed(a, [...old, minutesAgo(now, 30), minutesAgo(now, 1)]);
    await seed(b, [minutesAgo(now, 120)]);
    await boardSignalsCleanupJob.run({ tenantId: a, now, tx: tenantDb(db, a) });
    expect(await count(a)).toBe(2);
    expect(await count(b)).toBe(1);
    // Idempoten.
    await boardSignalsCleanupJob.run({ tenantId: a, now, tx: tenantDb(db, a) });
    expect(await count(a)).toBe(2);
  });

  it('role aplikasi tanpa DELETE; fungsi menolak batch tidak sah dan tidak menghapus sinyal < 10 menit', async () => {
    const t = await freshTenant('Sinyal C');
    const now = new Date();
    await seed(t, [minutesAgo(now, 5), minutesAgo(now, 20)]);
    await expect(tenantDb(db, t)((tx) => tx.boardSignal.deleteMany({}))).rejects.toThrow();
    await expect(
      tenantDb(db, t)((tx) => tx.$queryRaw`SELECT app_purge_board_signals(now(), 0)`),
    ).rejects.toThrow(/BOARD_SIGNALS_PURGE_LIMIT/);
    const [row] = await tenantDb(
      db,
      t,
    )((tx) => tx.$queryRaw<Array<{ n: number }>>`SELECT app_purge_board_signals(now(), 100) AS n`);
    expect(row?.n).toBe(1);
    expect(await count(t)).toBe(1);
  });
});
