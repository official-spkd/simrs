/**
 * P09 · Operasi outbox notifikasi: payload hanya ID, alamat dibaca (no. HP didekripsi) saat dikirim, respons tidak
 * disimpan (alamat = data pribadi), akun nonaktif / tanpa alamat dilewati. Target = stub HTTP lokal.
 */
import 'reflect-metadata';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { createPrismaClient, enqueueOutbox, type PrismaClient, withTenant } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  AUTH_BACKUP_CODE_OPERATION,
  newId,
  NOTIFY_EMAIL_OPERATION,
  NOTIFY_WHATSAPP_OPERATION,
} from '@simrs/shared';
import { encryptField } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv, WORKER_ENV, type WorkerEnv } from '../src/config/env';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { WorkerModule } from '../src/worker.module';

let stub: Server;
const received: Array<{ url: string; body: Record<string, unknown> }> = [];
let env: WorkerEnv;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;

beforeAll(async () => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // opsional
  }
  stub = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      received.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') as Record<string, unknown> });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"messageId":"m-1"}');
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrls().app,
    MOCK_BASE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
    OUTBOX_HTTP_TIMEOUT_MS: '2000',
    WEB_BASE_URL: 'http://simrs.test',
  });
  const ref = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(WORKER_ENV)
    .useValue(env)
    .compile();
  dispatcher = ref.get(OutboxDispatcher);
  db = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  T = newId();
  try {
    await withTenant(owner, T, (tx) =>
      tx.tenant.create({
        data: { id: T, code: `NT${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Notifikasi' },
      }),
    );
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await dispatcher?.onModuleDestroy();
  await db?.$disconnect();
  await new Promise<void>((r) => stub.close(() => r()));
});

beforeEach(() => {
  received.length = 0;
});

const read = <R>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<R>) =>
  withTenant(db, T, fn);

async function notification(user: { email?: string; phone?: string; status?: string }) {
  return read(async (tx) => {
    const userId = newId();
    await tx.user.create({
      data: {
        id: userId,
        tenantId: T,
        username: `n.${userId.slice(-8)}`,
        displayName: 'Petugas Privasi Fiktif',
        email: user.email ?? null,
        phoneEnc: user.phone
          ? encryptField(user.phone, {
              keyB64: env.FIELD_ENCRYPTION_KEY,
              tenantId: T,
              purpose: 'staff_phone',
            })
          : null,
        status: user.status ?? 'active',
      },
    });
    const id = newId();
    await tx.notification.create({
      data: {
        id,
        tenantId: T,
        recipientUserId: userId,
        kind: 'break_glass',
        title: 'Akses darurat digunakan',
        body: 'Tinjau alasannya.',
        link: '/sistem/audit?tinjau=abc',
      },
    });
    const ids: string[] = [];
    for (const [target, operation, key] of [
      ['email', NOTIFY_EMAIL_OPERATION, 'notify-email'],
      ['whatsapp', NOTIFY_WHATSAPP_OPERATION, 'notify-wa'],
    ] as const) {
      const m = await enqueueOutbox(tx, T, {
        target,
        operation,
        idempotencyKey: `${key}:${id}`,
        payload: { notificationId: id },
      });
      ids.push(m.id);
    }
    return { id, messageIds: ids };
  });
}

describe('notifikasi email dan WhatsApp (operasi outbox)', () => {
  it('email + WhatsApp terkirim dengan tautan absolut; no. HP didekripsi saat dikirim; respons tidak disimpan', async () => {
    const n = await notification({ email: 'privasi@rs-fiktif.test', phone: '6281200002222' });
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    const mail = received.find((r) => r.url === '/email/send');
    expect(mail?.body).toMatchObject({
      to: 'privasi@rs-fiktif.test',
      subject: '[SIM RS] Akses darurat digunakan',
    });
    expect(mail?.body.text).toContain('Buka: http://simrs.test/sistem/audit?tinjau=abc');
    expect(received.find((r) => r.url === '/whatsapp/send')?.body).toMatchObject({ to: '6281200002222' });
    const msgs = await read((tx) =>
      tx.outboxMessage.findMany({ where: { id: { in: n.messageIds } }, include: { deliveries: true } }),
    );
    expect(msgs.map((m) => m.status)).toEqual(['sent', 'sent']);
    for (const m of msgs) expect(m.deliveries[0]?.responseExcerpt ?? null).toBeNull();
  });

  it('akun nonaktif atau tanpa alamat dilewati tanpa memanggil pengirim', async () => {
    await notification({ email: 'nonaktif@rs-fiktif.test', phone: '6281200003333', status: 'disabled' });
    await notification({});
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    expect(received).toEqual([]);
  });
});

describe('kode cadangan login (operasi outbox)', () => {
  it('kode dikirim ke WhatsApp akun saat tantangan masih terbuka; tantangan terpakai dilewati', async () => {
    const send = async (consumed: boolean) =>
      read(async (tx) => {
        const userId = newId();
        await tx.user.create({
          data: {
            id: userId,
            tenantId: T,
            username: `k.${userId.slice(-8)}`,
            displayName: 'Perawat Fiktif',
            phoneEnc: encryptField('6281200004444', {
              keyB64: env.FIELD_ENCRYPTION_KEY,
              tenantId: T,
              purpose: 'staff_phone',
            }),
          },
        });
        const id = newId();
        await tx.loginChallenge.create({
          data: {
            id,
            tenantId: T,
            userId,
            secretHash: 'a'.repeat(64),
            expiresAt: new Date(Date.now() + 5 * 60_000),
            consumedAt: consumed ? new Date() : null,
            otpEnc: encryptField('482913', {
              keyB64: env.FIELD_ENCRYPTION_KEY,
              tenantId: T,
              purpose: 'login_otp',
            }),
            otpChannel: 'whatsapp',
            otpSentAt: new Date(),
            otpSends: 1,
          },
        });
        await enqueueOutbox(tx, T, {
          target: 'whatsapp',
          operation: AUTH_BACKUP_CODE_OPERATION,
          idempotencyKey: `login-otp:${id}:1`,
          payload: { challengeId: id },
        });
      });
    await send(false);
    await send(true);
    await dispatcher.dispatchOnce({ tenantIds: [T] });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ url: '/whatsapp/send', body: { to: '6281200004444' } });
    expect(String(received[0]?.body.text)).toMatch(
      /^Kode masuk SIM RS: 482913\. Berlaku sampai pukul \d{2}\.\d{2} WIB/,
    );
  });
});
