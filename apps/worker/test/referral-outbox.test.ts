/**
 * F06/F07 · Operasi outbox surat kontrol, SPRI, dan rujukan keluar terhadap mock BPJS SUNGGUHAN (`apps/mock`, port
 * acak), fase 2 potongan 7:
 * - surat kontrol: mock gagal → baris tetap `pending` (pesan dicoba ulang) → pulih → nomor BPJS + `active` + `sent`;
 *   batal → hapus di BPJS (`dihapus` di mock), hapus ulang yang sudah hilang tetap `sent`;
 * - ditolak BPJS (dokter tidak praktik di tanggal itu) → `rejected` + kode, tanpa nomor; DLQ → `dead`;
 * - SPRI dengan no. kartu didekripsi saat kirim; rujukan keluar dari SEP terbit (masa berlaku dari BPJS) + hapus;
 * - pesan urut lama dilewati; data pribadi tidak tersimpan di outbox. Data fiktif.
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
  BPJS_RENCANA_KONTROL_DELETE_OPERATION,
  BPJS_RENCANA_KONTROL_INSERT_OPERATION,
  BPJS_RUJUKAN_DELETE_OPERATION,
  BPJS_RUJUKAN_INSERT_OPERATION,
  BPJS_SEP_INSERT_OPERATION,
  BPJS_SPRI_INSERT_OPERATION,
  type FrontOfficeOperation,
  isoDateJakarta,
  newId,
  outboxKey,
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
const ids: Record<string, string> = {};

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
  T = await freshTenant('Uji Rujukan');
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
  await run(async (tx) => {
    ids.PD = (await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } })).id;
    ids.andini = (
      await tx.practitioner.findFirstOrThrow({ where: { name: { startsWith: 'dr. Andini' } } })
    ).id;
    ids.MELATI = (await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' } })).id;
  });
});

afterAll(async () => {
  await ref?.close();
  await db?.$disconnect();
  await mock?.close();
});

beforeEach(() => setMock('normal'));

function run<R>(fn: (tx: TenantTx) => Promise<R>) {
  return tenantDb(db, T)(fn);
}
const dispatch = (minutes = 0) =>
  dispatcher.dispatchOnce({ tenantIds: [T], now: new Date(Date.now() + 1000 + minutes * 60_000) });
async function drain(minutes = 0) {
  for (let i = 0; i < 6; i++) {
    const s = await dispatch(minutes);
    if (s.claimed === 0) return;
  }
}
const setMock = (mode: 'normal' | 'gagal') =>
  mockState.scenarios.set('bpjs', { ...mockState.scenario('bpjs'), mode });
const referral = (id: string) => run((tx) => tx.referral.findUniqueOrThrow({ where: { id } }));
const enqueue = (
  operation: FrontOfficeOperation,
  payload: Record<string, string>,
  rowId: string,
  seq: number,
) =>
  run((tx) =>
    enqueueOutbox(tx, T, {
      target: 'bpjs',
      operation,
      idempotencyKey: outboxKey(operation, rowId, seq),
      payload,
    }),
  );

/** Tanggal ke depan (WIB, ≥ besok) dengan hari ISO yang diminta: dr. Andini (99001) praktik Sen–Kam dan Sabtu. */
function nextDate(weekdays: number[]): string {
  for (let i = 1; i <= 14; i++) {
    const d = isoDateJakarta(new Date(Date.now() + i * 86_400_000));
    const iso = ((new Date(`${d}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
    if (weekdays.includes(iso)) return d;
  }
  throw new Error('tanggal tidak ditemukan');
}
const PRAKTIK = [1, 2, 3, 4, 6];

let n = 0;
/** Kunjungan RJ BPJS di poli PD dengan SEP yang DITERBITKAN mock lewat worker (dasar surat kontrol/rujukan keluar). */
async function encounterWithSep() {
  n += 1;
  const tag = `${Date.now() % 1e5}${n}`.padStart(6, '0').slice(-6);
  const card = `0000124${tag}`;
  const today = isoDateJakarta(new Date());
  const peserta = pesertaByKartu(mockState.bpjs, card, today, today);
  const number = peserta ? (rujukanNumbersFor(peserta, 'fktp')[0] as string) : `9999P001${card.slice(-9)}01`;
  const crypto = new PatientCrypto(
    { encKeyB64: process.env.FIELD_ENCRYPTION_KEY ?? '', hashKeyB64: process.env.FIELD_HASH_KEY ?? '' },
    T,
  );
  const r = await run(async (tx) => {
    const patient = await insertPatient(tx, crypto, {
      name: 'Pasien Rujukan Fiktif',
      sex: 'female',
      birthDate: '1970-03-04',
      phone: `6281301${tag}`,
      identifiers: { nik: `9999010102${tag}`, bpjs: card },
    });
    const ident = await tx.patientIdentifier.findFirstOrThrow({
      where: { patientId: patient.id, system: 'bpjs', active: true },
    });
    const service = await tx.queueService.findUniqueOrThrow({ where: { id: ids.PD as string } });
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
        practitionerId: ids.andini as string,
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
        classEntitlement: 'kelas_2',
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
    return { patientId: patient.id, encounterId, sepId };
  });
  await enqueue(BPJS_SEP_INSERT_OPERATION, { sepId: r.sepId }, r.sepId, 1);
  await drain();
  const sep = await run((tx) => tx.sep.findUniqueOrThrow({ where: { id: r.sepId } }));
  expect(sep.status).toBe('issued');
  return { ...r, card, sepNo: sep.sepNo as string };
}

/** Baris surat/rujukan seperti hasil API (`pending`, tanpa nomor) + pesan insert urut 1. */
async function pendingReferral(
  e: { patientId: string; encounterId: string },
  data: Record<string, unknown>,
  operation: FrontOfficeOperation,
) {
  const id = newId();
  const today = isoDateJakarta(new Date());
  await run((tx) =>
    tx.referral.create({
      data: {
        id,
        tenantId: T,
        patientId: e.patientId,
        encounterId: e.encounterId,
        issuedOn: new Date(`${today}T00:00:00.000Z`),
        status: 'pending',
        syncStatus: 'pending',
        facilityName: 'Poli Penyakit Dalam',
        kind: 'surat-kontrol',
        ...data,
      } as Parameters<TenantTx['referral']['create']>[0]['data'],
    }),
  );
  await enqueue(operation, { referralId: id }, id, 1);
  return id;
}

const kontrolData = (planned: string) => ({
  kind: 'surat-kontrol',
  targetServiceId: ids.PD,
  practitionerId: ids.andini,
  plannedDate: new Date(`${planned}T00:00:00.000Z`),
  validUntil: new Date(`${planned}T00:00:00.000Z`),
  diagnosisCode: 'I10',
  diagnosisDisplay: 'Hipertensi esensial (primer)',
});

/** Batal dari API: `cancelled` + status kirim pending + urut berikutnya + pesan hapus. */
async function cancelAndDelete(id: string, operation: FrontOfficeOperation, seq: number) {
  await run((tx) =>
    tx.referral.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'Pasien batal kontrol',
        syncStatus: 'pending',
        syncSeq: seq,
      },
    }),
  );
  await enqueue(operation, { referralId: id }, id, seq);
}

describe('surat kontrol', () => {
  it('DoD gangguan BPJS: mock gagal → tetap pending (dicoba ulang) → pulih → nomor + active; batal → dihapus di BPJS', async () => {
    const e = await encounterWithSep();
    const planned = nextDate(PRAKTIK);
    setMock('gagal');
    const id = await pendingReferral(e, kontrolData(planned), BPJS_RENCANA_KONTROL_INSERT_OPERATION);
    await dispatch();
    expect(await referral(id)).toMatchObject({ status: 'pending', number: null, syncStatus: 'pending' });
    const msg = await run((tx) =>
      tx.outboxMessage.findFirstOrThrow({
        where: { idempotencyKey: outboxKey(BPJS_RENCANA_KONTROL_INSERT_OPERATION, id, 1) },
      }),
    );
    expect(msg.status).toBe('failed');
    setMock('normal');
    await drain(11);
    const r = await referral(id);
    expect(r).toMatchObject({ status: 'active', syncStatus: 'sent', syncErrorCode: null });
    expect(r.number).toMatch(new RegExp(`^${PPK}\\d{4}K\\d{6}$`));
    const surat = mockState.bpjs.surat.get(r.number as string);
    expect(surat).toMatchObject({
      jenis: 'kontrol',
      noSepAsal: e.sepNo,
      kodeDokter: '99001',
      poliKontrol: 'INT',
      tglRencanaKontrol: planned,
    });
    // Pesan urut lama yang terkirim ulang tidak membuat surat kedua.
    const count = mockState.bpjs.surat.size;
    await enqueue(BPJS_RENCANA_KONTROL_INSERT_OPERATION, { referralId: id }, id, 7);
    await drain();
    expect(mockState.bpjs.surat.size).toBe(count);

    await cancelAndDelete(id, BPJS_RENCANA_KONTROL_DELETE_OPERATION, 2);
    await drain();
    expect(await referral(id)).toMatchObject({ status: 'cancelled', syncStatus: 'sent' });
    expect(mockState.bpjs.surat.get(r.number as string)?.status).toBe('dihapus');
    // Hapus ulang (mis. setelah DLQ) untuk surat yang sudah tidak ada → tujuan tercapai.
    await run((tx) => tx.referral.update({ where: { id }, data: { syncStatus: 'pending', syncSeq: 3 } }));
    await enqueue(BPJS_RENCANA_KONTROL_DELETE_OPERATION, { referralId: id }, id, 3);
    await drain();
    expect(await referral(id)).toMatchObject({ syncStatus: 'sent', syncErrorCode: null });
    // Payload outbox hanya ID.
    const msgs = await run((tx) =>
      tx.outboxMessage.findMany({ where: { payload: { path: ['referralId'], equals: id } } }),
    );
    expect(JSON.stringify(msgs)).not.toContain(e.card);
  });

  it('ditolak BPJS (dokter tidak praktik) → rejected tanpa nomor; DLQ → dead', async () => {
    const e = await encounterWithSep();
    const id = await pendingReferral(e, kontrolData(nextDate([7])), BPJS_RENCANA_KONTROL_INSERT_OPERATION);
    await drain();
    expect(await referral(id)).toMatchObject({
      status: 'pending',
      number: null,
      syncStatus: 'rejected',
      syncErrorCode: 'BPJS_JADWAL_TIDAK_DITEMUKAN',
    });

    setMock('gagal');
    const dlq = await pendingReferral(
      e,
      kontrolData(nextDate(PRAKTIK)),
      BPJS_RENCANA_KONTROL_INSERT_OPERATION,
    );
    await dispatch();
    await dispatch(26 * 60);
    expect(await referral(dlq)).toMatchObject({
      status: 'pending',
      syncStatus: 'dead',
      syncErrorCode: 'BPJS_DLQ',
    });
  });
});

describe('SPRI dan rujukan keluar', () => {
  it('SPRI: no. kartu dari penjaminan, poli DPJP → nomor SPRI; batal → dihapus', async () => {
    const e = await encounterWithSep();
    const planned = nextDate(PRAKTIK);
    const id = await pendingReferral(
      e,
      {
        kind: 'spri',
        facilityName: 'Bangsal Melati',
        targetUnitId: ids.MELATI,
        targetServiceId: ids.PD,
        practitionerId: ids.andini,
        plannedDate: new Date(`${planned}T00:00:00.000Z`),
      },
      BPJS_SPRI_INSERT_OPERATION,
    );
    await drain();
    const r = await referral(id);
    expect(r).toMatchObject({ kind: 'spri', status: 'active', syncStatus: 'sent' });
    expect(mockState.bpjs.surat.get(r.number as string)).toMatchObject({
      jenis: 'spri',
      noKartu: e.card,
      poliKontrol: 'INT',
    });
    await cancelAndDelete(id, BPJS_RENCANA_KONTROL_DELETE_OPERATION, 2);
    await drain();
    expect(mockState.bpjs.surat.get(r.number as string)?.status).toBe('dihapus');
  });

  it('rujukan keluar dari SEP terbit → nomor + masa berlaku BPJS; batal → dihapus', async () => {
    const e = await encounterWithSep();
    const planned = isoDateJakarta(new Date(Date.now() + 3 * 86_400_000));
    const id = await pendingReferral(
      e,
      {
        kind: 'rujukan-keluar',
        facilityName: 'RS Fiktif Bahari',
        ppkCode: '0301R002',
        serviceType: 'rawat_jalan',
        referralType: 'penuh',
        bpjsPoliCode: 'JAN',
        diagnosisCode: 'I10',
        diagnosisDisplay: 'Hipertensi esensial (primer)',
        note: 'Evaluasi jantung',
        plannedDate: new Date(`${planned}T00:00:00.000Z`),
      },
      BPJS_RUJUKAN_INSERT_OPERATION,
    );
    await drain();
    const r = await referral(id);
    expect(r).toMatchObject({ status: 'active', syncStatus: 'sent' });
    expect(r.number).toMatch(new RegExp(`^${PPK}\\d{4}B\\d{6}$`));
    expect(r.validUntil).not.toBeNull();
    const rec = mockState.bpjs.rujukanKeluar.get(r.number as string);
    expect(rec?.tRujukan).toMatchObject({
      noSep: e.sepNo,
      ppkDirujuk: '0301R002',
      poliRujukan: 'JAN',
      tipeRujukan: '0',
      tglRencanaKunjungan: planned,
      catatan: 'Evaluasi jantung',
    });
    await cancelAndDelete(id, BPJS_RUJUKAN_DELETE_OPERATION, 2);
    await drain();
    expect(await referral(id)).toMatchObject({ status: 'cancelled', syncStatus: 'sent' });
    expect(mockState.bpjs.rujukanKeluar.get(r.number as string)?.status).toBe('dihapus');
  });
});
