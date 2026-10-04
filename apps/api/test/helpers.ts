import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  type NewPatientRecord,
  type PrismaClient,
  withTenant,
} from '@simrs/db';
import { SEED_PLATFORM_TENANT, testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import {
  base32Decode,
  encryptField,
  generateTotpSecret,
  hashPassword,
  PatientCrypto,
  totpCode,
  totpStep,
} from '@simrs/shared/node';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadApiEnv } from '../src/config/env';

export const TENANT_A = '0199a000-0000-7000-8000-000000000001';
export const TENANT_B = '0199a000-0000-7000-8000-000000000002';
/** Tenant khusus operator platform (superadmin_platform). */
export const TENANT_PLATFORM: string = SEED_PLATFORM_TENANT.id;
export const TENANT_CODES: Record<string, string> = {
  [TENANT_A]: 'RSFA',
  [TENANT_B]: 'RSFB',
  [TENANT_PLATFORM]: SEED_PLATFORM_TENANT.code,
};

/** Folder penyimpanan berkas dokumen saat tes (bukan `.local/storage` milik pengembangan). */
export const TEST_STORAGE_ROOT = join(tmpdir(), 'simrs-api-test-storage');

/** Bangun aplikasi persis seperti main.ts, dengan env yang bisa ditimpa per tes. DB = simrs_test (simrs_app). */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const env = loadApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: testDbUrls().app,
    // Tes modul memakai mode header pengembang; tes auth memakai token sungguhan.
    ALLOW_DEV_TENANT_HEADER: 'true',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    // Supertest datang dari loopback; X-Forwarded-For hanya dipercaya dari sana (seperti web BFF lokal).
    TRUST_PROXY: 'loopback',
    STORAGE_DRIVER: 'disk',
    STORAGE_DISK_ROOT: TEST_STORAGE_ROOT,
    ...overrides,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true, rawBody: true });
  configureApp(app, env);
  await app.init();
  return app;
}

export interface TestUser {
  id: string;
  tenantId: string;
  tenantCode: string;
  username: string;
  password: string;
  totpSecret: string | null;
}

let sharedDb: PrismaClient | undefined;
function db(): PrismaClient {
  sharedDb ??= createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  return sharedDb;
}

/** Pengguna fiktif dengan kata sandi kuat, opsional MFA TOTP terkonfirmasi. Username unik per tes. */
export async function createTestUser(
  tenantId: string,
  opts: {
    mfa?: boolean;
    mustChangePassword?: boolean;
    status?: 'active' | 'disabled';
    /** Penugasan peran (kode peran sistem), opsional per unit. */
    roles?: Array<{ code: string; unitId?: string }>;
    tenantCode?: string;
  } = {},
): Promise<TestUser> {
  const id = newId();
  const username = `uji.${id.slice(-12)}`;
  const password = `frasa uji panjang ${id.slice(-6)}`;
  const totpSecret = opts.mfa === false ? null : generateTotpSecret();
  const passwordHash = await hashPassword(password);
  await withTenant(db(), tenantId, async (tx) => {
    await tx.user.create({
      data: {
        id,
        tenantId,
        username,
        displayName: 'Pengguna Uji Fiktif',
        status: opts.status ?? 'active',
        mustChangePassword: opts.mustChangePassword ?? false,
      },
    });
    await tx.userCredential.create({ data: { userId: id, tenantId, passwordHash } });
    for (const r of opts.roles ?? []) {
      const role = await tx.role.findFirstOrThrow({ where: { code: r.code } });
      await tx.staffAssignment.create({
        data: { id: newId(), tenantId, userId: id, roleId: role.id, unitId: r.unitId ?? null },
      });
    }
    if (totpSecret) {
      await tx.mfaFactor.create({
        data: {
          id: newId(),
          tenantId,
          userId: id,
          secretEnc: encryptField(totpSecret, {
            keyB64: process.env.FIELD_ENCRYPTION_KEY ?? '',
            tenantId,
            purpose: 'mfa_secret',
          }),
          confirmedAt: new Date(),
        },
      });
    }
  });
  return {
    id,
    tenantId,
    tenantCode: opts.tenantCode ?? TENANT_CODES[tenantId] ?? '',
    username,
    password,
    totpSecret,
  };
}

/** Kode TOTP untuk langkah berikutnya yang belum dipakai pengguna ini (anti-replay sungguhan berlaku). */
const lastStep = new Map<string, number>();
export function nextTotp(user: TestUser): string {
  if (!user.totpSecret) throw new Error('Pengguna tanpa MFA');
  const step = Math.max(totpStep(), (lastStep.get(user.id) ?? -Infinity) + 1);
  if (step > totpStep() + 1) throw new Error('Kode TOTP habis untuk jendela ini; tunggu 30 detik');
  lastStep.set(user.id, step);
  return totpCode(base32Decode(user.totpSecret), step);
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Login penuh: kata sandi → kode TOTP → token sesi. */
export async function login(app: NestExpressApplication, user: TestUser): Promise<Tokens> {
  const step1 = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ tenantCode: user.tenantCode, username: user.username, password: user.password })
    .expect(200);
  if (step1.body.status !== 'mfa_required') throw new Error(`Login tanpa MFA: ${step1.body.status}`);
  const step2 = await request(app.getHttpServer())
    .post('/api/v1/auth/mfa/verify')
    .send({ challengeToken: step1.body.challengeToken, code: nextTotp(user) })
    .expect(200);
  return { accessToken: step2.body.accessToken, refreshToken: step2.body.refreshToken };
}

export const bearer = (t: { accessToken: string }) => ({ Authorization: `Bearer ${t.accessToken}` });

export function testDb(): PrismaClient {
  return db();
}

/** JSON untuk memeriksa isi baris (mis. audit tanpa PHI); kolom `seq` BigInt diubah ke teks. */
export const jsonText = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));

/** Enkripsi identitas pasien dengan kunci .env (sama dengan API yang diuji). */
export function testPatientCrypto(tenantId: string): PatientCrypto {
  return new PatientCrypto(
    { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '', hashKeyB64: process.env.FIELD_HASH_KEY ?? '' },
    tenantId,
  );
}

/** Pasien fiktif langsung di DB (tanpa API/audit), mis. untuk relasi dan akses darurat. */
export function createTestPatient(
  tenantId: string,
  rec: Partial<NewPatientRecord> = {},
): Promise<{ id: string; mrn: string }> {
  return withTenant(db(), tenantId, (tx) =>
    insertPatient(tx, testPatientCrypto(tenantId), {
      name: 'Pasien Uji Fiktif',
      sex: 'female',
      birthDate: '1980-01-01',
      ...rec,
    }),
  );
}

/** Tenant fiktif baru (dengan 16 peran sistem) untuk tes yang butuh keadaan bersih, mis. "admin terakhir". */
export async function createTestTenant(): Promise<{ id: string; code: string }> {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  const id = newId();
  const code = `T${id
    .slice(-10)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')}`;
  try {
    await withTenant(owner, id, async (tx) => {
      await tx.tenant.create({ data: { id, code, name: 'RS Fiktif Uji' } });
      await ensureSystemRoles(tx, id);
    });
  } finally {
    await owner.$disconnect();
  }
  return { id, code };
}
