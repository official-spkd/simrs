/**
 * F06 · Operasi outbox SEP terhadap mock BPJS SUNGGUHAN (`apps/mock`, port acak), fase 2 potongan 5a:
 * - terbit bertahap: cek peserta (kelas hak → penjaminan) → insert → `issued`, penjaminan terkunci, event `sep.issued`;
 * - DoD "gangguan BPJS": mock `gagal` → SEP tetap `pending` (dicoba ulang), lalu `issued` setelah pulih;
 * - timeout setelah BPJS memproses → kiriman ulang dijawab SEP ganda → nomor diambil dari histori, TIDAK ada SEP kedua;
 * - penolakan (peserta tidak aktif, rujukan tidak ditemukan) → `failed` + alasan; DLQ → `failed` + `dead`;
 * - kirim ulang (urut baru) terbit; pesan lama/ganda dilewati; revisi (update) dan batal (delete). Data fiktif.
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { TestingModule } from '@nestjs/testing';
import {
  createPrismaClient,
  enqueueOutbox,
  insertPatient,
  type PrismaClient,
  seedFrontOffice,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import {
  BPJS_SEP_DELETE_OPERATION,
  BPJS_SEP_INSERT_OPERATION,
  BPJS_SEP_UPDATE_OPERATION,
  type FrontOfficeOperation,
  isoDateJakarta,
  newId,
  outboxKey,
  SEP_NO_PATTERN,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../mock/src/config';
import { pesertaByKartu } from '../../mock/src/systems/bpjs/peserta';
import { rujukanNumbersFor } from '../../mock/src/systems/bpjs/rujukan';
import { buildServer } from '../../mock/src/server';
import { MockState } from '../../mock/src/state';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { freshTenant, loadTestEnvFile, tenantDb, testEnv, testModule } from './helpers';

const PPK = '0301R001';
let mock: ReturnType<typeof buildServer>;
let mockState: MockState;
let ref: TestingModule;
let db: PrismaClient;
let dispatcher: OutboxDispatcher;
let T: string;

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
  T = await freshTenant('Uji SEP');
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await withTenant(owner, T, async (tx) => {
      await seedHospitalStructure(tx, T);
      await tx.tenant.update({ where: { id: T }, data: { bpjsPpkCode: PPK } });
    });
    await seedFrontOffice(owner, T);
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

// Hanya skenario yang dikembalikan: data SEP mock dipertahankan antar-tes agar nomor SEP tidak terulang (nomor di
// BPJS unik; mengulang urut mock akan tampak seperti SEP kunjungan lain).
beforeEach(() => setMock('normal'));

const run = <R>(fn: (tx: TenantTx) => Promise<R>) => tenantDb(db, T)(fn);
/** Satu putaran pengiriman; `minutes` = jam semu ke depan (lewati jeda coba ulang). */
const dispatch = (minutes = 0) =>
  dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000 + minutes * 60_000) });
/** Kirim sampai tidak ada pesan siap kirim (tahap SEP berikutnya diantrekan di dalam transaksi hasil). */
async function drain(minutes = 0) {
  for (let i = 0; i < 6; i++) {
    const s = await dispatch(minutes);
    if (s.claimed === 0) return;
  }
}
const sep = (id: string) => run((tx) => tx.sep.findUniqueOrThrow({ where: { id } }));
const mockSeps = (card: string) => [...mockState.bpjs.seps.values()].filter((s) => s.tSep.noKartu === card);
const setMock = (mode: 'normal' | 'gagal' | 'timeout', timeoutMs = 3000) =>
  mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode, timeoutMs });
const enqueue = (operation: FrontOfficeOperation, sepId: string, seq: number) =>
  run((tx) =>
    enqueueOutbox(tx, T, {
      target: 'bpjs',
      operation,
      idempotencyKey: outboxKey(operation, sepId, seq),
      payload: { sepId },
    }),
  );

let n = 0;
/**
 * Kunjungan BPJS seperti hasil registrasi API: pasien + kunjungan RJ (poli PD, dr. Andini = DPJP 99001) +
 * penjaminan BPJS + rujukan FKTP aktif milik kartu (nomor mock) + SEP v1 `pending` + pesan insert urut 1.
 */
async function registered(
  opts: { card?: string; referenceNumber?: string; classEntitlement?: string; phone?: string | null } = {},
) {
  n += 1;
  const tag = `${Date.now() % 1e5}${n}`.padStart(6, '0').slice(-6);
  const card = opts.card ?? `0000123${tag}`;
  const today = isoDateJakarta(new Date());
  const peserta = pesertaByKartu(mockState.bpjs, card, today, today);
  const number =
    opts.referenceNumber ?? (peserta ? rujukanNumbersFor(peserta, 'fktp')[0] : `9999P001${card.slice(-9)}01`);
  const crypto = new PatientCrypto(
    { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '', hashKeyB64: process.env.FIELD_HASH_KEY ?? '' },
    T,
  );
  const ids = await run(async (tx) => {
    const patient = await insertPatient(tx, crypto, {
      name: 'Pasien SEP Fiktif',
      sex: 'male',
      birthDate: '1975-05-06',
      phone: opts.phone === undefined ? `6281300${tag}` : opts.phone,
      identifiers: { nik: `9999010101${tag}`, bpjs: card },
    });
    const ident = await tx.patientIdentifier.findFirstOrThrow({
      where: { patientId: patient.id, system: 'bpjs', active: true },
    });
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const practitioner = await tx.practitioner.findFirstOrThrow({
      where: { name: { startsWith: 'dr. Andini' } },
    });
    const payer = await tx.payer.findFirstOrThrow({ where: { kind: 'bpjs' } });
    const encounterId = newId();
    await tx.encounter.create({
      data: {
        id: encounterId,
        tenantId: T,
        number: `RJ-2610-${tag}`,
        patientId: patient.id,
        encounterClass: 'AMB',
        status: 'arrived',
        unitId: service.unitId as string,
        serviceId: service.id,
        practitionerId: practitioner.id,
        arrivedAt: new Date(),
      },
    });
    const coverageId = newId();
    await tx.coverage.create({
      data: {
        id: coverageId,
        tenantId: T,
        encounterId,
        payerId: payer.id,
        patientIdentifierId: ident.id,
        classEntitlement: opts.classEntitlement ?? null,
      },
    });
    const referralId = newId();
    await tx.referral.create({
      data: {
        id: referralId,
        tenantId: T,
        patientId: patient.id,
        kind: 'rujukan-fktp',
        number,
        ppkCode: number.slice(0, 8),
        facilityName: 'FKTP Fiktif',
        issuedOn: new Date(`${today}T00:00:00.000Z`),
        status: 'active',
      },
    });
    const sepId = newId();
    await tx.sep.create({
      data: {
        id: sepId,
        tenantId: T,
        encounterId,
        coverageId,
        referralId,
        status: 'pending',
        serviceType: 'rawat_jalan',
        poliCode: 'INT',
        diagnosisCode: 'I10',
        diagnosisDisplay: 'Hipertensi esensial (primer)',
      },
    });
    return { sepId, encounterId, coverageId };
  });
  await enqueue(BPJS_SEP_INSERT_OPERATION, ids.sepId, 1);
  return { ...ids, card };
}

describe('terbitkan SEP', () => {
  it('peserta → insert → issued: kelas hak di penjaminan, penjaminan terkunci, event sep.issued, satu SEP di BPJS', async () => {
    const r = await registered();
    await dispatch();
    const afterPeserta = await run((tx) => tx.coverage.findUniqueOrThrow({ where: { id: r.coverageId } }));
    expect(afterPeserta.classEntitlement).toMatch(/^kelas_[123]$/);
    expect((await sep(r.sepId)).syncSeq).toBe(2);
    await drain();
    const s = await sep(r.sepId);
    expect(s).toMatchObject({
      status: 'issued',
      syncStatus: 'sent',
      lastErrorCode: null,
      rejectionReason: null,
    });
    expect(s.sepNo).toMatch(SEP_NO_PATTERN);
    expect(s.sepNo?.startsWith(PPK)).toBe(true);
    const cov = await run((tx) => tx.coverage.findUniqueOrThrow({ where: { id: r.coverageId } }));
    expect(cov.lockedAt).not.toBeNull();
    const events = await run((tx) =>
      tx.domainEvent.findMany({
        where: { name: 'sep.issued', payload: { path: ['sepId'], equals: r.sepId } },
      }),
    );
    expect(events).toHaveLength(1);
    expect(mockSeps(r.card)).toHaveLength(1);
    // Pesan lama/ganda setelah terbit dilewati: tidak ada SEP kedua.
    await enqueue(BPJS_SEP_INSERT_OPERATION, r.sepId, 9);
    await drain();
    expect(mockSeps(r.card)).toHaveLength(1);
    // Data pribadi tidak tersimpan di pesan outbox maupun jejak pengirimannya.
    const msgs = await run((tx) =>
      tx.outboxMessage.findMany({
        where: { operation: BPJS_SEP_INSERT_OPERATION, payload: { path: ['sepId'], equals: r.sepId } },
        include: { deliveries: true },
      }),
    );
    expect(JSON.stringify(msgs)).not.toContain(r.card);
  });

  it('DoD gangguan BPJS: mock gagal → SEP tetap pending (dicoba ulang), pulih → issued', async () => {
    const r = await registered({ classEntitlement: 'kelas_2' });
    setMock('gagal');
    await dispatch();
    expect(await sep(r.sepId)).toMatchObject({ status: 'pending', syncStatus: 'pending' });
    const msg = await run((tx) =>
      tx.outboxMessage.findFirstOrThrow({
        where: { idempotencyKey: outboxKey(BPJS_SEP_INSERT_OPERATION, r.sepId, 1) },
      }),
    );
    expect(msg.status).toBe('failed');
    setMock('normal');
    await drain(11);
    expect(await sep(r.sepId)).toMatchObject({ status: 'issued', syncStatus: 'sent' });
    expect(mockSeps(r.card)).toHaveLength(1);
  });

  it('timeout setelah BPJS memproses → kirim ulang dijawab SEP ganda → nomor dari histori, tetap satu SEP', async () => {
    const r = await registered({ classEntitlement: 'kelas_1' });
    setMock('timeout', 3000);
    await dispatch();
    // Mock sudah menerbitkan SEP, tetapi jawabannya tidak pernah sampai.
    expect(mockSeps(r.card)).toHaveLength(1);
    expect(await sep(r.sepId)).toMatchObject({ status: 'pending', sepNo: null });
    setMock('normal');
    await dispatch(11); // insert ulang → BPJS_SEP_GANDA → tahap histori diantrekan
    expect(await sep(r.sepId)).toMatchObject({
      status: 'pending',
      lastErrorCode: 'BPJS_SEP_GANDA',
      syncSeq: 2,
    });
    await drain(11);
    const s = await sep(r.sepId);
    expect(s.status).toBe('issued');
    expect(s.sepNo).toBe(mockSeps(r.card)[0]?.noSep);
    expect(mockSeps(r.card)).toHaveLength(1);
  });
});

describe('pasien tanpa no. HP (keputusan utang fase 2)', () => {
  const setContactPhone = (value: string) =>
    run((tx) =>
      tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: T, key: 'bpjs.contact_phone' } },
        create: { tenantId: T, key: 'bpjs.contact_phone', value },
        update: { value },
      }),
    );

  it('noTelp SEP = no. telepon RS bila diatur, selain itu 0000000000', async () => {
    try {
      await setContactPhone('');
      const a = await registered({ classEntitlement: 'kelas_1', phone: null });
      await drain();
      expect(mockSeps(a.card)[0]?.tSep.noTelp).toBe('0000000000');
      await setContactPhone('0215550123');
      const b = await registered({ classEntitlement: 'kelas_1', phone: null });
      await drain();
      expect(mockSeps(b.card)[0]?.tSep.noTelp).toBe('0215550123');
      const c = await registered({ classEntitlement: 'kelas_1' });
      await drain();
      expect(mockSeps(c.card)[0]?.tSep.noTelp).toMatch(/^081300\d{6}$/);
    } finally {
      await setContactPhone('');
    }
  });
});

describe('penolakan, DLQ, kirim ulang', () => {
  it('peserta tidak aktif → failed (tanpa insert); rujukan tidak dikenal → failed + alasan', async () => {
    const inactive = await registered({ card: `00001${String(Date.now() % 1e4).padStart(4, '0')}0000` });
    await drain();
    expect(await sep(inactive.sepId)).toMatchObject({
      status: 'failed',
      lastErrorCode: 'BPJS_PESERTA_TIDAK_AKTIF',
      syncStatus: 'rejected',
      syncErrorCode: 'BPJS_PESERTA_TIDAK_AKTIF',
    });
    expect(mockSeps(inactive.card)).toHaveLength(0);

    const badRef = await registered({ referenceNumber: '0301R0011025K000117', classEntitlement: 'kelas_3' });
    await drain();
    const s = await sep(badRef.sepId);
    expect(s).toMatchObject({
      status: 'failed',
      lastErrorCode: 'BPJS_RUJUKAN_TIDAK_DITEMUKAN',
      syncStatus: 'rejected',
    });
    expect(s.rejectionReason).toMatch(/Rujukan tidak ditemukan/);
  });

  it('DLQ (lewat akhir hari layanan) → failed + dead; kirim ulang urut baru → issued; pesan urut lama dilewati', async () => {
    const r = await registered({ classEntitlement: 'kelas_1' });
    setMock('gagal');
    await dispatch(); // gagal, dicoba ulang
    await dispatch(26 * 60); // jadwal ulang melewati akhir hari layanan → DLQ
    expect(await sep(r.sepId)).toMatchObject({
      status: 'failed',
      lastErrorCode: 'BPJS_DLQ',
      syncStatus: 'dead',
      syncErrorCode: 'BPJS_DLQ',
    });
    setMock('normal');
    // Kirim ulang dari API: baris pending lagi + pesan urut 2.
    await run((tx) =>
      tx.sep.update({
        where: { id: r.sepId },
        data: {
          status: 'pending',
          lastErrorCode: null,
          rejectionReason: null,
          syncStatus: 'pending',
          syncErrorCode: null,
          syncSeq: 2,
        },
      }),
    );
    await enqueue(BPJS_SEP_INSERT_OPERATION, r.sepId, 2);
    await drain();
    expect(await sep(r.sepId)).toMatchObject({ status: 'issued', syncStatus: 'sent' });
    expect(mockSeps(r.card)).toHaveLength(1);
  });
});

describe('revisi dan batal', () => {
  it('versi 2 → update diterima (issued, nomor sama); batal → delete diterima; hapus ulang yang sudah hilang tetap sent', async () => {
    const r = await registered();
    await drain();
    const v1 = await sep(r.sepId);
    expect(v1.status).toBe('issued');
    const v2Id = newId();
    await run((tx) =>
      tx.sep.create({
        data: {
          id: v2Id,
          tenantId: T,
          encounterId: r.encounterId,
          coverageId: r.coverageId,
          referralId: v1.referralId,
          version: 2,
          supersedesId: v1.id,
          correctionReason: 'Koreksi diagnosa awal',
          status: 'pending',
          sepNo: v1.sepNo,
          serviceType: 'rawat_jalan',
          poliCode: 'INT',
          diagnosisCode: 'E11.9',
          diagnosisDisplay: 'Diabetes melitus tipe 2',
        },
      }),
    );
    await enqueue(BPJS_SEP_UPDATE_OPERATION, v2Id, 1);
    await drain();
    expect(await sep(v2Id)).toMatchObject({ status: 'issued', sepNo: v1.sepNo, syncStatus: 'sent' });
    const rec = mockState.bpjs.seps.get(v1.sepNo as string);
    expect(rec?.versi).toBe(2);
    expect(rec?.tSep.diagAwal).toBe('E11.9');

    await run((tx) =>
      tx.sep.update({
        where: { id: v2Id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'Pasien batal berobat',
          syncStatus: 'pending',
          syncSeq: 2,
        },
      }),
    );
    await enqueue(BPJS_SEP_DELETE_OPERATION, v2Id, 2);
    await drain();
    expect(await sep(v2Id)).toMatchObject({ status: 'cancelled', syncStatus: 'sent' });
    expect(mockState.bpjs.seps.get(v1.sepNo as string)?.status).toBe('dihapus');

    // Kirim ulang hapus (mis. setelah DLQ) untuk SEP yang sudah tidak ada di BPJS → tujuan tercapai.
    await run((tx) => tx.sep.update({ where: { id: v2Id }, data: { syncStatus: 'pending', syncSeq: 3 } }));
    await enqueue(BPJS_SEP_DELETE_OPERATION, v2Id, 3);
    await drain();
    expect(await sep(v2Id)).toMatchObject({ status: 'cancelled', syncStatus: 'sent', syncErrorCode: null });
  });
});
