/**
 * ADR-0025 · Lookup sinkron di luar transaksi permintaan: `@NoRequestTransaction()` + `LookupGateway`.
 * Konektor palsu menggantikan klien BPJS/Dukcapil (konektor nyata menyusul di potongan 5a).
 */
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { withTenant } from '@simrs/db';
import { AppError, newId } from '@simrs/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoRequestTransaction } from '../src/common/no-request-transaction.decorator';
import { RequireModule } from '../src/common/require-module.decorator';
import { RequirePermission } from '../src/common/require-permission.decorator';
import { TenantScoped } from '../src/common/tenant-scoped.decorator';
import { LOOKUP_TIMEOUT_MS } from '../src/infra/lookup/lookup-connector';
import { LookupGateway } from '../src/infra/lookup/lookup.gateway';
import { TenantDb } from '../src/infra/tenant-db';
import { FakeLookupConnector } from './fakes/fake-lookup-connector';
import {
  bearer,
  createTestApp,
  createTestUser,
  jsonText,
  login,
  TENANT_A,
  type Tokens,
  testDb,
} from './helpers';

interface Peserta {
  found: boolean;
  active: boolean;
  /** Data pribadi fiktif: tidak boleh muncul di audit. */
  name: string;
}

const peserta = new FakeLookupConnector<{ cardNo: string }, Peserta>(
  'bpjs.vclaim.peserta',
  'bpjs',
  150,
  (o) => ({ found: o.found, active: o.active }),
);
/** Batas waktu bawaan (5 dtk): untuk tes banyak panggilan lambat serentak. */
const slow = new FakeLookupConnector<{ cardNo: string }, Peserta>('bpjs.vclaim.rujukan', 'bpjs');
const demografi = new FakeLookupConnector<{ nik: string }, { name: string }>(
  'dukcapil.demografi',
  'dukcapil',
  150,
);

/** Jumlah transaksi simrs_app yang sedang terbuka (idle in transaction) di database tes ini. */
async function openTransactions(): Promise<number> {
  const [row] = await testDb().$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND usename = 'simrs_app' AND state LIKE 'idle in transaction%'`;
  return row?.n ?? 0;
}

@TenantScoped()
@Controller('test-infra/lookup')
class LookupTestController {
  constructor(
    private readonly gateway: LookupGateway,
    private readonly db: TenantDb,
  ) {}

  @NoRequestTransaction()
  @RequirePermission('patient', 'read')
  @Post('bpjs/:patientId')
  @HttpCode(200)
  bpjs(@Param('patientId') patientId: string, @Body() body: { cardNo: string }) {
    return this.gateway.lookup(peserta, { cardNo: body.cardNo }, { patientId });
  }

  @NoRequestTransaction()
  @RequirePermission('patient', 'read')
  @Post('bpjs-persist/:patientId')
  @HttpCode(200)
  bpjsPersist(@Param('patientId') patientId: string, @Body() body: { cardNo: string; marker: string }) {
    return this.gateway.lookup(
      peserta,
      { cardNo: body.cardNo },
      {
        patientId,
        persist: async (out) => {
          if (!this.db.inTransaction()) throw new Error('persist di luar transaksi');
          this.db.audit({ action: 'create', resourceType: 'test_snapshot', resourceId: body.marker });
          if (!out.active) throw new AppError('CONFLICT', 'Peserta tidak aktif', 409);
          return { saved: true, active: out.active };
        },
      },
    );
  }

  @NoRequestTransaction()
  @Post('slow')
  @HttpCode(200)
  slow(@Body() body: { cardNo: string }) {
    return this.gateway.lookup(slow, { cardNo: body.cardNo });
  }

  @NoRequestTransaction()
  @Post('dukcapil')
  @HttpCode(200)
  dukcapil(@Body() body: { nik: string }) {
    return this.gateway.lookup(demografi, { nik: body.nik });
  }

  /** Tanpa @NoRequestTransaction: gateway wajib menolak sebelum menghubungi sistem luar. */
  @Post('in-transaction')
  @HttpCode(200)
  inTransaction(@Body() body: { cardNo: string }) {
    return this.gateway.lookup(peserta, { cardNo: body.cardNo });
  }

  @NoRequestTransaction()
  @RequireModule('I07')
  @Post('module-off')
  @HttpCode(200)
  moduleOff(@Body() body: { cardNo: string }) {
    return this.gateway.lookup(peserta, { cardNo: body.cardNo });
  }

  /** `TenantDb.tx()` di luar transaksi pendek = galat program; `TenantDb.transaction()` membuka transaksi pendek. */
  @NoRequestTransaction()
  @Get('tx-probe')
  async txProbe() {
    let bare = 'ok';
    try {
      this.db.tx();
    } catch {
      bare = 'refused';
    }
    const inside = await this.db.transaction(async () => {
      const [row] = await this.db.tx().$queryRaw<Array<{ tenant: string }>>`
        SELECT current_setting('app.tenant_id') AS tenant`;
      let nested = 'ok';
      try {
        await this.db.transaction(async () => undefined);
      } catch {
        nested = 'refused';
      }
      return { tenant: row?.tenant, nested };
    });
    return { bare, inTransactionAfter: this.db.inTransaction(), ...inside };
  }
}

let app: NestExpressApplication;
const http = () => request(app.getHttpServer());
const asDev = (path: string, body: object, requestId = newId()) =>
  http().post(path).set('X-Tenant-Id', TENANT_A).set('X-Request-Id', requestId).send(body);
const tokens: Record<string, Tokens> = {};

async function auditRows(requestId: string) {
  return withTenant(testDb(), TENANT_A, (tx) =>
    tx.auditEvent.findMany({ where: { requestId }, orderBy: { seq: 'asc' } }),
  );
}

beforeAll(async () => {
  app = await createTestApp(
    {},
    { imports: [{ module: class LookupTestModule {}, controllers: [LookupTestController] }] },
  );
  for (const code of ['petugas_pendaftaran', 'akuntan']) {
    tokens[code] = await login(app, await createTestUser(TENANT_A, { roles: [{ code }] }));
  }
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  peserta.calls.length = 0;
  slow.calls.length = 0;
  demografi.calls.length = 0;
});

describe('LookupGateway (ADR-0025)', () => {
  it('batas waktu bawaan 5 detik', () => {
    expect(LOOKUP_TIMEOUT_MS).toBe(5_000);
  });

  it('berhasil: hasil dikembalikan, audit requested + completed tanpa PHI, tanpa transaksi terbuka saat panggilan', async () => {
    const patientId = newId();
    let openDuringCall = -1;
    peserta.runs(async () => {
      openDuringCall = await openTransactions();
      return { found: true, active: true, name: 'Peserta Fiktif Rahasia' };
    });
    const requestId = newId();
    const res = await asDev(
      `/api/v1/test-infra/lookup/bpjs/${patientId}`,
      { cardNo: '0009990001234' },
      requestId,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: true, active: true, name: 'Peserta Fiktif Rahasia' });
    expect(openDuringCall).toBe(0);
    expect(peserta.calls).toHaveLength(1);

    const rows = await auditRows(requestId);
    expect(rows.map((r) => (r.details as { phase?: string }).phase)).toEqual(['requested', 'completed']);
    for (const r of rows) {
      expect(r).toMatchObject({ action: 'read', resourceType: 'bpjs.vclaim.peserta', patientId });
    }
    expect(rows[1]?.details).toMatchObject({ summary: { found: true, active: true }, target: 'bpjs' });
    const text = jsonText(rows);
    expect(text).not.toContain('0009990001234');
    expect(text).not.toContain('Rahasia');
  });

  it('audit requested sudah ter-commit saat sistem luar dihubungi (gagal tertutup)', async () => {
    const requestId = newId();
    let seenBeforeCall: string[] = [];
    peserta.runs(async () => {
      seenBeforeCall = (await auditRows(requestId)).map((r) => (r.details as { phase: string }).phase);
      return { found: true, active: true, name: 'x' };
    });
    await asDev(`/api/v1/test-infra/lookup/bpjs/${newId()}`, { cardNo: '1' }, requestId).expect(200);
    expect(seenBeforeCall).toEqual(['requested']);
  });

  it('timeout → 503 BPJS_UNAVAILABLE, sinyal dibatalkan, audit failed', async () => {
    peserta.hangs();
    const requestId = newId();
    const started = Date.now();
    const res = await asDev(
      `/api/v1/test-infra/lookup/bpjs/${newId()}`,
      { cardNo: '0009990001234' },
      requestId,
    );
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'BPJS_UNAVAILABLE',
      details: { lookup: 'bpjs.vclaim.peserta', reason: 'timeout' },
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(peserta.calls[0]?.signal.aborted).toBe(true);
    const rows = await auditRows(requestId);
    expect(rows.map((r) => (r.details as { phase: string }).phase)).toEqual(['requested', 'failed']);
    expect(rows[1]?.details).toMatchObject({ reason: 'timeout' });
    expect(jsonText(rows)).not.toContain('0009990001234');
  });

  it('galat jaringan → 503 BPJS_UNAVAILABLE (pesan galat tidak bocor ke klien)', async () => {
    peserta.fails(new Error('ECONNREFUSED 10.0.0.1 kartu 0009990001234'));
    const res = await asDev(`/api/v1/test-infra/lookup/bpjs/${newId()}`, { cardNo: '0009990001234' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'BPJS_UNAVAILABLE', details: { reason: 'error' } });
    expect(JSON.stringify(res.body)).not.toContain('0009990001234');
  });

  it('penolakan bisnis berkode (AppError) diteruskan apa adanya + audit failed/rejected', async () => {
    peserta.fails(new AppError('NOT_FOUND', 'Peserta tidak ditemukan', 404));
    const requestId = newId();
    const res = await asDev(`/api/v1/test-infra/lookup/bpjs/${newId()}`, { cardNo: '1' }, requestId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    const rows = await auditRows(requestId);
    expect(rows[1]?.details).toMatchObject({ phase: 'failed', reason: 'rejected', code: 'NOT_FOUND' });
  });

  it('Dukcapil tidak tersedia → 503 INTEGRATION_UNAVAILABLE', async () => {
    demografi.hangs();
    const res = await asDev('/api/v1/test-infra/lookup/dukcapil', { nik: '3174000000000001' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'INTEGRATION_UNAVAILABLE',
      details: { lookup: 'dukcapil.demografi' },
    });
  });

  it('persist berjalan di transaksi pendek, atomik dengan audit completed', async () => {
    const marker = newId();
    peserta.returns({ found: true, active: true, name: 'x' });
    const ok = newId();
    await asDev(`/api/v1/test-infra/lookup/bpjs-persist/${newId()}`, { cardNo: '1', marker }, ok)
      .expect(200)
      .expect({ saved: true, active: true });
    expect((await auditRows(ok)).map((r) => r.resourceType)).toEqual([
      'bpjs.vclaim.peserta',
      'test_snapshot',
      'bpjs.vclaim.peserta',
    ]);

    // persist gagal → snapshot dan audit completed batal bersama; jejak requested tetap ada.
    peserta.returns({ found: true, active: false, name: 'x' });
    const failed = newId();
    await asDev(
      `/api/v1/test-infra/lookup/bpjs-persist/${newId()}`,
      { cardNo: '1', marker: newId() },
      failed,
    ).expect(409);
    const rows = await auditRows(failed);
    expect(rows.map((r) => (r.details as { phase?: string } | null)?.phase)).toEqual(['requested']);
  });

  it('dipanggil di dalam transaksi permintaan → ditolak sebelum menghubungi sistem luar', async () => {
    peserta.returns({ found: true, active: true, name: 'x' });
    const res = await asDev('/api/v1/test-infra/lookup/in-transaction', { cardNo: '1' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(peserta.calls).toHaveLength(0);
  });

  it('izin tetap ditegakkan: peran tanpa patient.read → 403 + audit access_denied, konektor tidak dipanggil', async () => {
    peserta.returns({ found: true, active: true, name: 'x' });
    const requestId = newId();
    const res = await http()
      .post(`/api/v1/test-infra/lookup/bpjs/${newId()}`)
      .set(bearer(tokens.akuntan as Tokens))
      .set('X-Request-Id', requestId)
      .send({ cardNo: '1' });
    expect(res.status).toBe(403);
    expect(peserta.calls).toHaveLength(0);
    expect((await auditRows(requestId)).map((r) => [r.action, r.outcome])).toEqual([
      ['access_denied', 'denied'],
    ]);

    await http()
      .post(`/api/v1/test-infra/lookup/bpjs/${newId()}`)
      .set(bearer(tokens.petugas_pendaftaran as Tokens))
      .send({ cardNo: '1' })
      .expect(200);
    expect(peserta.calls).toHaveLength(1);
  });

  it('modul RS mati → 403 MODULE_DISABLED tanpa memanggil konektor', async () => {
    peserta.returns({ found: true, active: true, name: 'x' });
    const res = await asDev('/api/v1/test-infra/lookup/module-off', { cardNo: '1' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MODULE_DISABLED');
    expect(peserta.calls).toHaveLength(0);
  });

  it('TenantDb: tx() ditolak tanpa transaksi, transaction() memberi transaksi pendek bertenant, tanpa bersarang', async () => {
    const res = await http()
      .get('/api/v1/test-infra/lookup/tx-probe')
      .set('X-Tenant-Id', TENANT_A)
      .expect(200);
    expect(res.body).toEqual({
      bare: 'refused',
      inTransactionAfter: false,
      tenant: TENANT_A,
      nested: 'refused',
    });
  });

  it('banyak lookup lambat serentak tidak menghabiskan pool koneksi', async () => {
    // Pool API bawaan 10 koneksi; 12 lookup yang menunggu sistem luar tidak memegang satu pun.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    slow.runs(async () => {
      await gate;
      return { found: true, active: true, name: 'x' };
    });
    const pending = Array.from({ length: 12 }, () =>
      asDev('/api/v1/test-infra/lookup/slow', { cardNo: '1' }).then((r) => r.status),
    );
    for (let i = 0; i < 150 && slow.calls.length < 12; i++) await new Promise((r) => setTimeout(r, 20));
    expect(slow.calls).toHaveLength(12);
    expect(await openTransactions()).toBe(0);
    await http().get('/api/v1/test-infra/lookup/tx-probe').set('X-Tenant-Id', TENANT_A).expect(200);
    release();
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 12 }, () => 200));
  });
});
