/**
 * K05 · Operasi outbox `bpjs.aplicare.update` terhadap mock BPJS SUNGGUHAN (`apps/mock`, port acak), fase 3 potongan
 * 3.3: kode kelas resmi dari referensi Aplicare → daftarkan ruang → perbarui hitungan terbaru; pesan revisi lama
 * dilewati; ruang yang hilang di BPJS didaftarkan ulang; kelas tanpa padanan dicatat sebagai galat. Data fiktif.
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  type PrismaClient,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { BPJS_APLICARE_UPDATE_OPERATION, clinicalOutboxKey, newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { aplicareList } from '../../mock/src/systems/bpjs/aplicare';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv, testModule } from './helpers';

const PPK = '0301R002';
const OP = BPJS_APLICARE_UPDATE_OPERATION;
let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;
let melati: string;
let mawar: string;

beforeAll(async () => {
  loadTestEnvFile();
  mockState = new MockState();
  mock = buildServer({ ...loadConfig({}), port: 0 }, mockState);
  await mock.listen({ port: 0, host: '127.0.0.1' });
  const port = (mock.server.address() as AddressInfo).port;
  const env = testEnv({
    MOCK_BASE_URL: `http://127.0.0.1:${port}`,
    BPJS_BASE_URL: `http://127.0.0.1:${port}/bpjs`,
    BPJS_CONS_ID: '10000',
    BPJS_SECRET_KEY: 'mock-secret',
    BPJS_USER_KEY: 'mock-user-key',
    OUTBOX_HTTP_TIMEOUT_MS: '1000',
  });
  ref = await testModule(env);
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  T = await freshTenant('Uji Aplicare');
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, T, async (tx) => {
      const units = await seedHospitalStructure(tx, T);
      melati = units.get('MELATI') as string;
      mawar = units.get('MAWAR') as string;
      await tx.tenant.update({ where: { id: T }, data: { bpjsPpkCode: PPK } });
      const beds = await tx.location.findMany({ where: { kind: 'bed' }, select: { id: true, unitId: true } });
      for (const b of beds) {
        await tx.bedStatus.create({ data: { id: newId(), tenantId: T, locationId: b.id, unitId: b.unitId } });
      }
    });
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => tenantDb(db, T)(fn);
async function drain() {
  for (let i = 0; i < 8; i++) {
    const s = await dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000) });
    if (s.claimed === 0) return;
  }
}
const ruang = (koderuang: string) => aplicareList(mockState.bpjs, PPK).find((r) => r.koderuang === koderuang);

/** Seperti `AplicareSyncService.touch` di API: baris ruang (bila belum ada) + revisi naik + pesan. */
async function touch(unitId: string, careClass: string, roomCode: string) {
  return run(async (tx) => {
    await tx.aplicareRoom.createMany({
      data: [{ id: newId(), tenantId: T, unitId, careClass, roomCode, roomName: `Ruang ${roomCode}` }],
      skipDuplicates: true,
    });
    const room = await tx.aplicareRoom.update({
      where: { tenantId_unitId_careClass: { tenantId: T, unitId, careClass } },
      data: { revision: { increment: 1 } },
    });
    await enqueueOutbox(tx, T, {
      target: 'bpjs',
      operation: OP,
      idempotencyKey: clinicalOutboxKey(OP, room.id, room.revision),
      payload: { roomId: room.id, revision: room.revision },
    });
    return room;
  });
}
const room = (id: string) => run((tx) => tx.aplicareRoom.findUniqueOrThrow({ where: { id } }));

describe('bpjs.aplicare.update', () => {
  it('kode kelas resmi → daftar ruang → perbarui hitungan; revisi lama dilewati', async () => {
    const r1 = await touch(melati, 'kelas_2', 'MELATI-K2');
    await drain();
    expect(await room(r1.id)).toMatchObject({ classCode: 'KL2', sentRevision: 1, lastErrorCode: null });
    expect((await room(r1.id)).registeredAt).not.toBeNull();
    // Melati kelas 2 fixture: 12 bed, semua siap.
    expect(ruang('MELATI-K2')).toMatchObject({ kodekelas: 'KL2', kapasitas: 12, tersedia: 12 });

    // Satu bed kotor, satu rusak → kapasitas 11 (rusak tidak dihitung), tersedia 10.
    await run(async (tx) => {
      const beds = await tx.location.findMany({
        where: { unitId: melati, careClass: 'kelas_2', kind: 'bed' },
        orderBy: { code: 'asc' },
        take: 2,
      });
      await tx.bedStatus.update({
        where: { tenantId_locationId: { tenantId: T, locationId: beds[0]?.id as string } },
        data: { status: 'kotor', version: 2 },
      });
      await tx.bedStatus.update({
        where: { tenantId_locationId: { tenantId: T, locationId: beds[1]?.id as string } },
        data: { status: 'rusak', version: 2 },
      });
    });
    const r2 = await touch(melati, 'kelas_2', 'MELATI-K2');
    // Pesan revisi 1 yang terlambat: dilewati (hitungan terbaru dibawa revisi 2).
    await run((tx) =>
      enqueueOutbox(tx, T, {
        target: 'bpjs',
        operation: OP,
        idempotencyKey: `${clinicalOutboxKey(OP, r1.id, 1)}:9`,
        payload: { roomId: r1.id, revision: 1 },
      }),
    );
    await drain();
    expect(await room(r2.id)).toMatchObject({ sentRevision: 2, lastErrorCode: null });
    expect(ruang('MELATI-K2')).toMatchObject({ kapasitas: 11, tersedia: 10 });
  });

  it('ruang hilang di BPJS → daftar ulang otomatis', async () => {
    const r = await touch(melati, 'kelas_3', 'MELATI-K3');
    await drain();
    expect(ruang('MELATI-K3')).toBeDefined();
    mockState.bpjs.aplicare.get(PPK)?.delete('KL3|MELATI-K3');
    const again = await touch(melati, 'kelas_3', 'MELATI-K3');
    await drain();
    expect(ruang('MELATI-K3')).toMatchObject({ kapasitas: 4, tersedia: 4 });
    expect(await room(r.id)).toMatchObject({ sentRevision: again.revision });
  });

  it('kelas tanpa padanan di referensi Aplicare → galat tercatat, tidak dikirim', async () => {
    const r = await touch(mawar, 'vvip', 'MAWAR-VVIP');
    await drain();
    expect(await room(r.id)).toMatchObject({
      classCode: null,
      registeredAt: null,
      lastErrorCode: 'BPJS_KELAS_TIDAK_DITEMUKAN',
    });
    expect(ruang('MAWAR-VVIP')).toBeUndefined();
  });
});
