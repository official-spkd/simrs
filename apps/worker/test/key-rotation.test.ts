/**
 * P05 · Job enkripsi ulang kolom di worker (rotasi kunci v2, ADR-0015 pembaruan 5 Okt 2026): env cincin kunci
 * divalidasi saat start, putaran dilewati bila cincin hanya berisi kunci aktif, putaran menulis ulang data tenant ke
 * kunci aktif (idempoten), dan tenant yang datanya memakai kunci tak dikenal dihentikan tanpa menulis (gagal
 * tertutup). Tenant fiktif baru; kunci v2 acak khusus tes ini.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { createPrismaClient, insertPatient, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import { legacyFieldKeys, PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { KeyRotationJob } from '../src/key-rotation/key-rotation.job';
import { WorkerModule } from '../src/worker.module';

const v2Enc = randomBytes(32).toString('base64');
const v2Hash = randomBytes(32).toString('base64');
let base: Record<string, string | undefined>;
let env: WorkerEnv;
let job: KeyRotationJob;
let close: () => Promise<void>;
let db: PrismaClient;
let owner: PrismaClient;

async function tenantWithV1Patient(): Promise<{ id: string; nik: string }> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({ data: { id, code: `KW${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Rotasi' } }),
  );
  const nik = `9999${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
  // Ditulis seperti sebelum rotasi: kunci format lama (FIELD_*_KEY = v1).
  const v1 = legacyFieldKeys(base.FIELD_ENCRYPTION_KEY ?? '', base.FIELD_HASH_KEY ?? '');
  await withTenant(db, id, (tx) =>
    insertPatient(tx, new PatientCrypto(v1, id), {
      name: 'Pasien Fiktif Rotasi',
      sex: 'female',
      birthDate: '1980-01-01',
      phone: '6281200007777',
      address: 'Jl. Uji No. 1',
      identifiers: { nik },
    }),
  );
  return { id, nik };
}

const identifierOf = (tenantId: string) =>
  withTenant(db, tenantId, (tx) =>
    tx.patientIdentifier.findFirstOrThrow({ select: { valueEnc: true, valueHash: true } }),
  );

beforeAll(async () => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
  base = { ...process.env, NODE_ENV: 'test', DATABASE_URL: testDbUrls().app };
  env = loadWorkerEnv({ ...base, FIELD_ENCRYPTION_KEYS: `v2:${v2Enc}`, FIELD_HASH_KEYS: `v2:${v2Hash}` });
  const ref = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(WORKER_ENV)
    .useValue(env)
    .compile();
  await ref.init();
  job = ref.get(KeyRotationJob);
  close = () => ref.close();
  db = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
});

afterAll(async () => {
  await close?.();
  await db?.$disconnect();
  await owner?.$disconnect();
});

describe('env cincin kunci worker', () => {
  it('cincin dari env: v2 aktif, kunci format lama = v1; job otomatis mati secara bawaan', () => {
    expect(env.fieldKeys.enc.ids).toEqual(['v2', 'v1']);
    expect(env.fieldKeys.hash.currentId).toBe('v2');
    expect(env.FIELD_KEY_ROTATION).toBe('off');
    expect(env.FIELD_KEY_ROTATION_BATCH).toBe(200);
  });

  it('kunci hilang atau bertentangan → worker gagal start dengan pesan jelas tanpa nilai kunci', () => {
    expect(() => loadWorkerEnv({ ...base, FIELD_ENCRYPTION_KEY: '', FIELD_ENCRYPTION_KEYS: '' })).toThrow(
      /Konfigurasi env tidak valid → FIELD_ENCRYPTION_KEYS atau FIELD_ENCRYPTION_KEY wajib/,
    );
    const other = randomBytes(32).toString('base64');
    let message = '';
    try {
      loadWorkerEnv({ ...base, FIELD_ENCRYPTION_KEYS: `v2:${v2Enc},v1:${other}` });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/FIELD_ENCRYPTION_KEY berbeda dengan v1 di FIELD_ENCRYPTION_KEYS/);
    expect(message).not.toContain(other);
    expect(message).not.toContain(base.FIELD_ENCRYPTION_KEY ?? '-');
  });
});

describe('job enkripsi ulang (worker)', () => {
  it('cincin satu kunci: tidak ada yang diputar', async () => {
    const single = new KeyRotationJob(loadWorkerEnv(base));
    try {
      expect(await single.runOnce({ tenantIds: [newId()] })).toMatchObject({
        skipped: 'single_key',
        tenants: 0,
      });
    } finally {
      await single.onModuleDestroy();
    }
  });

  it('menulis ulang data tenant ke v2; putaran kedua tidak menulis apa pun; data tetap tercari', async () => {
    const t = await tenantWithV1Patient();
    expect((await identifierOf(t.id)).valueEnc.startsWith('v1.')).toBe(true);
    const first = await job.runOnce({ tenantIds: [t.id] });
    expect(first).toMatchObject({ tenants: 1, failed: 0, blocked: [], interrupted: false });
    // patients (alamat + HP + hash HP) dan patient_identifiers (NIK).
    expect(first.rewritten).toBe(2);
    const row = await identifierOf(t.id);
    expect(row.valueEnc.startsWith('v2.')).toBe(true);
    expect(row.valueHash).toMatch(/^v2:/);
    const crypto = new PatientCrypto(env.fieldKeys, t.id);
    expect(crypto.decryptIdentifier(row.valueEnc)).toBe(t.nik);
    expect(crypto.identifierHash('nik', t.nik)).toBe(row.valueHash);
    expect(await job.runOnce({ tenantIds: [t.id] })).toMatchObject({ rewritten: 0, failed: 0, blocked: [] });
  });

  it('kunci lama sudah dihapus padahal datanya belum diputar → tenant dihentikan tanpa menulis (gagal tertutup)', async () => {
    const t = await tenantWithV1Patient();
    const retired = new KeyRotationJob(
      loadWorkerEnv({
        ...base,
        FIELD_ENCRYPTION_KEYS: `v2:${v2Enc},v3:${randomBytes(32).toString('base64')}`,
        FIELD_ENCRYPTION_KEY: '',
        FIELD_HASH_KEYS: `v2:${v2Hash}`,
        FIELD_HASH_KEY: '',
      }),
    );
    try {
      const before = await identifierOf(t.id);
      const summary = await retired.runOnce({ tenantIds: [t.id] });
      expect(summary.rewritten).toBe(0);
      expect(summary.blocked).toEqual([
        { tenantId: t.id, codes: expect.arrayContaining(['FIELD_KEY_UNKNOWN:v1']) as string[] },
      ]);
      expect(await identifierOf(t.id)).toEqual(before);
    } finally {
      await retired.onModuleDestroy();
    }
  });
});
