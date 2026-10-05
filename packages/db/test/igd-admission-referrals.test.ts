/**
 * Fase 2 · potongan 7 · Skema IGD, admisi, SPRI/surat kontrol, rujukan (migrasi `20261005220000`): isian per kelas
 * kunjungan (CHECK), satu IGD/admisi aktif per pasien dan satu admisi per SPRI (indeks unik), kolom asal yang tetap
 * (juga pemilik tabel), rujukan batal beku kecuali status kirim, hak kolom aplikasi, FK komposit lintas tenant.
 */
import { newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  ensureSystemRoles,
  insertPatient,
  type PrismaClient,
  seedFrontOffice,
  seedHospitalStructure,
  type TenantTx,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const keys = {
  encKeyB64: Buffer.alloc(32, 41).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 43).toString('base64'),
};

let app: PrismaClient;
let owner: PrismaClient;
let A: string;
let B: string;

async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, async (tx) => {
    await tx.tenant.create({
      data: { id, code: `IG${id.slice(-6).toUpperCase()}`, name: 'RS Fiktif Uji IGD' },
    });
    await ensureSystemRoles(tx, id);
    await seedHospitalStructure(tx, id);
  });
  await seedFrontOffice(owner, id);
  return id;
}

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  A = await freshTenant();
  B = await freshTenant();
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, A, fn);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let seq = 0;
const num = (prefix: string) => {
  seq += 1;
  return `${prefix}-2710-${String(Date.now() % 1e4).padStart(4, '0')}${String(seq).padStart(2, '0')}`;
};

async function patient(tenantId: string) {
  return withTenant(app, tenantId, (tx) =>
    insertPatient(tx, new PatientCrypto(keys, tenantId), { name: 'Tn. X', sex: 'male', unidentified: true }),
  );
}
const unitId = (tx: TenantTx, code: string) =>
  tx.unit.findFirstOrThrow({ where: { code } }).then((u) => u.id);

function encounter(tenantId: string, data: Record<string, unknown>) {
  return withTenant(app, tenantId, async (tx) =>
    tx.encounter.create({
      data: {
        id: newId(),
        tenantId,
        number: num(data.encounterClass === 'IMP' ? 'RI' : 'IGD'),
        status: 'arrived',
        unitId: await unitId(tx, data.encounterClass === 'IMP' ? 'MELATI' : 'IGD'),
        ...data,
      } as Parameters<TenantTx['encounter']['create']>[0]['data'],
    }),
  );
}

describe('kunjungan IGD dan admisi', () => {
  it('CHECK per kelas: IGD wajib cara datang; admisi wajib rencana masuk; SPRI/rencana hanya admisi', async () => {
    const p = await patient(A);
    await expect(encounter(A, { patientId: p.id, encounterClass: 'EMER' })).rejects.toThrow(
      /encounters_class_fields/,
    );
    await expect(
      encounter(A, { patientId: p.id, encounterClass: 'EMER', arrivalMode: 'terbang' }),
    ).rejects.toThrow(/encounters_class_fields/);
    await expect(encounter(A, { patientId: p.id, encounterClass: 'IMP', status: 'planned' })).rejects.toThrow(
      /encounters_class_fields/,
    );
    await expect(
      encounter(A, {
        patientId: p.id,
        encounterClass: 'EMER',
        arrivalMode: 'ambulans',
        plannedAt: new Date(),
      }),
    ).rejects.toThrow(/encounters_class_fields/);
    const ok = await encounter(A, {
      patientId: p.id,
      encounterClass: 'EMER',
      arrivalMode: 'ambulans',
      identificationNote: 'Kaos biru',
    });
    expect(ok.arrivalMode).toBe('ambulans');
  });

  it('satu IGD aktif dan satu admisi aktif per pasien; batal membebaskan; satu admisi per SPRI', async () => {
    const p = await patient(A);
    const igd = await encounter(A, {
      patientId: p.id,
      encounterClass: 'EMER',
      arrivalMode: 'datang_sendiri',
    });
    await expect(
      encounter(A, { patientId: p.id, encounterClass: 'EMER', arrivalMode: 'datang_sendiri' }),
    ).rejects.toThrow(/Unique constraint/);
    await inA((tx) =>
      tx.encounter.update({
        where: { id: igd.id },
        data: { status: 'cancelled', cancelReason: 'Salah daftar' },
      }),
    );
    await encounter(A, { patientId: p.id, encounterClass: 'EMER', arrivalMode: 'datang_sendiri' });

    const spriId = newId();
    await inA((tx) =>
      tx.referral.create({
        data: {
          id: spriId,
          tenantId: A,
          patientId: p.id,
          kind: 'spri',
          number: `0301R0031027K${String(Date.now() % 1e6).padStart(6, '0')}`,
          facilityName: 'Bangsal Melati',
          issuedOn: day('2027-10-01'),
          status: 'active',
        },
      }),
    );
    const adm = await encounter(A, {
      patientId: p.id,
      encounterClass: 'IMP',
      status: 'planned',
      plannedAt: new Date(),
      referralId: spriId,
      sourceEncounterId: igd.id,
    });
    await expect(
      encounter(A, { patientId: p.id, encounterClass: 'IMP', status: 'planned', plannedAt: new Date() }),
    ).rejects.toThrow(/Unique constraint/);
    const p2 = await patient(A);
    // SPRI milik pasien lain pun tidak boleh dipakai dua admisi aktif (indeks per SPRI).
    await expect(
      encounter(A, {
        patientId: p2.id,
        encounterClass: 'IMP',
        status: 'planned',
        plannedAt: new Date(),
        referralId: spriId,
      }),
    ).rejects.toThrow(/Unique constraint/);
    // Asal kunjungan, SPRI, dan cara datang tetap (juga pemilik tabel).
    await expect(
      withTenant(owner, A, (tx) =>
        tx.encounter.update({ where: { id: adm.id }, data: { sourceEncounterId: null } }),
      ),
    ).rejects.toThrow(/IMMUTABLE_COLUMN/);
    await expect(
      withTenant(owner, A, (tx) =>
        tx.encounter.update({ where: { id: igd.id }, data: { arrivalMode: 'lainnya' } }),
      ),
    ).rejects.toThrow(/IMMUTABLE_COLUMN/);
  });

  it('FK komposit: kunjungan asal dan SPRI tidak bisa menunjuk baris RS lain', async () => {
    const pa = await patient(A);
    const igdA = await encounter(A, { patientId: pa.id, encounterClass: 'EMER', arrivalMode: 'ambulans' });
    const pb = await patient(B);
    await expect(
      encounter(B, {
        patientId: pb.id,
        encounterClass: 'IMP',
        status: 'planned',
        plannedAt: new Date(),
        sourceEncounterId: igdA.id,
      }),
    ).rejects.toThrow(/Foreign key constraint/);
    const melatiA = await inA((tx) => unitId(tx, 'MELATI'));
    await expect(
      withTenant(app, B, (tx) =>
        tx.referral.create({
          data: {
            id: newId(),
            tenantId: B,
            patientId: pb.id,
            kind: 'spri',
            facilityName: 'Bangsal',
            issuedOn: day('2027-10-01'),
            status: 'pending',
            targetUnitId: melatiA,
          },
        }),
      ),
    ).rejects.toThrow(/Foreign key constraint/);
    expect(await withTenant(app, B, (tx) => tx.encounter.count({ where: { id: igdA.id } }))).toBe(0);
  });
});

describe('rujukan: batal, status kirim, hak kolom', () => {
  async function pendingSpri() {
    const p = await patient(A);
    return inA(async (tx) =>
      tx.referral.create({
        data: {
          id: newId(),
          tenantId: A,
          patientId: p.id,
          kind: 'spri',
          facilityName: 'Bangsal Melati',
          targetUnitId: await unitId(tx, 'MELATI'),
          issuedOn: day('2027-10-01'),
          plannedDate: day('2027-10-02'),
          status: 'pending',
          syncStatus: 'pending',
        },
      }),
    );
  }

  it('batal wajib waktu + alasan; boleh tanpa nomor; sesudahnya beku kecuali status kirim (juga pemilik tabel)', async () => {
    const r = await pendingSpri();
    await expect(
      inA((tx) => tx.referral.update({ where: { id: r.id }, data: { status: 'cancelled' } })),
    ).rejects.toThrow(/referrals_detail_valid/);
    await expect(
      inA((tx) =>
        tx.referral.update({
          where: { id: r.id },
          data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'x' },
        }),
      ),
    ).rejects.toThrow(/referrals_detail_valid/);
    await inA((tx) =>
      tx.referral.update({
        where: { id: r.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'Salah dokter',
          syncStatus: 'rejected',
        },
      }),
    );
    await inA((tx) => tx.referral.update({ where: { id: r.id }, data: { syncStatus: 'dead', syncSeq: 2 } }));
    await expect(
      withTenant(owner, A, (tx) => tx.referral.update({ where: { id: r.id }, data: { status: 'pending' } })),
    ).rejects.toThrow(/REFERRAL_IMMUTABLE/);
    await expect(
      withTenant(owner, A, (tx) =>
        tx.referral.update({ where: { id: r.id }, data: { cancelReason: 'Alasan lain' } }),
      ),
    ).rejects.toThrow(/REFERRAL_IMMUTABLE/);
  });

  it('status kirim tervalidasi (sent wajib waktu); isi surat tidak bisa diubah aplikasi; unit tujuan hanya SPRI', async () => {
    const r = await pendingSpri();
    await expect(
      inA((tx) => tx.referral.update({ where: { id: r.id }, data: { syncStatus: 'sent' } })),
    ).rejects.toThrow(/referrals_sync_valid/);
    await expect(
      inA((tx) => tx.referral.update({ where: { id: r.id }, data: { syncStatus: 'terkirim' } })),
    ).rejects.toThrow(/referrals_sync_valid/);
    for (const data of [{ plannedDate: day('2027-10-09') }, { note: 'ubah' }, { targetUnitId: null }]) {
      await expect(inA((tx) => tx.referral.update({ where: { id: r.id }, data }))).rejects.toThrow(
        /permission denied/,
      );
    }
    const p = await patient(A);
    await expect(
      inA(async (tx) =>
        tx.referral.create({
          data: {
            id: newId(),
            tenantId: A,
            patientId: p.id,
            kind: 'surat-kontrol',
            facilityName: 'Poli',
            targetUnitId: await unitId(tx, 'MELATI'),
            issuedOn: day('2027-10-01'),
            status: 'pending',
          },
        }),
      ),
    ).rejects.toThrow(/referrals_detail_valid/);
  });
});
