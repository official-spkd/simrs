/**
 * P05 · Deteksi kemungkinan rekam medis ganda dan batasan jejak penggabungan di database.
 * Alur gabung/batal lewat API diuji di apps/api.
 */
import { newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  detectDuplicates,
  insertPatient,
  type NewPatientRecord,
  type PrismaClient,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

const keys = {
  encKeyB64: Buffer.alloc(32, 21).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 23).toString('base64'),
};
let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 5 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

async function freshTenant(): Promise<{ id: string; crypto: PatientCrypto }> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({
      data: { id, code: `MM${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Duplikat' },
    }),
  );
  return { id, crypto: new PatientCrypto(keys, id) };
}

const add = (T: { id: string; crypto: PatientCrypto }, rec: NewPatientRecord) =>
  withTenant(app, T.id, (tx) => insertPatient(tx, T.crypto, rec));

const SITI: NewPatientRecord = {
  name: 'Siti Rahmawati',
  sex: 'female',
  birthDate: '1972-03-14',
  motherName: 'Aminah',
  address: 'Jl. Kenanga No. 12, Jakarta Timur',
  phone: '6281200004567',
  identifiers: { nik: '9999745403724521' },
};

describe('deteksi kemungkinan rekam medis ganda (P05)', () => {
  it('mengusulkan pasangan sekali (A = RM lebih lama), idempoten, keputusan petugas tidak diusulkan ulang', async () => {
    const T = await freshTenant();
    const a = await add(T, SITI);
    await add(T, { name: 'Budi Santoso', sex: 'male', birthDate: '1965-06-02' });
    const b = await add(T, { ...SITI, name: 'Siti Rachmawati', address: 'Kenanga No.12, Jaktim' });

    const first = await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, b.id));
    expect(first).toEqual({ proposed: 1, superseded: 0, unreadable: [] });
    await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, a.id));
    const rows = await withTenant(app, T.id, (tx) => tx.patientMatchCandidate.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ patientAId: a.id, patientBId: b.id, status: 'open', score: 99 });
    expect(rows[0]?.reasons).toEqual([
      'nik_sama',
      'tgl_lahir_sama',
      'nama_mirip',
      'ibu_sama',
      'hp_sama',
      'alamat_sama',
    ]);

    await withTenant(app, T.id, (tx) =>
      tx.patientMatchCandidate.update({
        where: { id: rows[0]?.id },
        data: {
          status: 'distinct',
          decidedAt: new Date(),
          decidedBy: newId(),
          decisionReason: 'Kembar identik, dikonfirmasi keluarga',
        },
      }),
    );
    await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, b.id));
    const after = await withTenant(app, T.id, (tx) => tx.patientMatchCandidate.findMany());
    expect(after.map((r) => r.status)).toEqual(['distinct']);
  });

  it('kandidat terbuka ditutup (superseded) bila data dikoreksi dan tidak lagi cocok', async () => {
    const T = await freshTenant();
    await add(T, { name: 'Rina Wulandari', sex: 'female', birthDate: '1990-05-05', motherName: 'Sari Dewi' });
    const b = await add(T, {
      name: 'Rina Wulandary',
      sex: 'female',
      birthDate: '1990-05-05',
      motherName: 'Sari Dewi',
    });
    expect((await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, b.id))).proposed).toBe(1);
    await withTenant(app, T.id, (tx) =>
      tx.patient.update({ where: { id: b.id }, data: { sex: 'male', motherName: 'Wati' } }),
    );
    expect(await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, b.id))).toEqual({
      proposed: 0,
      superseded: 1,
      unreadable: [],
    });
  });

  it('data yang tidak bisa didekripsi tidak menggagalkan deteksi; dilaporkan per pasien', async () => {
    const T = await freshTenant();
    const otherKey = new PatientCrypto(
      { encKeyB64: Buffer.alloc(32, 99).toString('base64'), hashKeyB64: keys.hashKeyB64 },
      T.id,
    );
    const foreign = await withTenant(app, T.id, (tx) => insertPatient(tx, otherKey, SITI));
    const b = await add(T, { ...SITI, name: 'Siti Rachmawati' });
    const r = await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, b.id));
    expect(r.unreadable).toEqual([foreign.id]);
    // Hash tetap terbaca (kunci hash sama): pasangan tetap diusulkan dari NIK, tanggal lahir, dst.
    expect(r.proposed).toBe(1);
  });

  it('satu baris per pasangan tak berurutan; keputusan wajib lengkap', async () => {
    const T = await freshTenant();
    const a = await add(T, SITI);
    const b = await add(T, { ...SITI, name: 'Siti Rachmawati' });
    await withTenant(app, T.id, (tx) => detectDuplicates(tx, T.crypto, b.id));
    await expect(
      withTenant(app, T.id, (tx) =>
        tx.patientMatchCandidate.create({
          data: { id: newId(), tenantId: T.id, patientAId: b.id, patientBId: a.id, score: 50, reasons: [] },
        }),
      ),
    ).rejects.toThrow(/patient_match_candidates_pair/);
    const [c] = await withTenant(app, T.id, (tx) => tx.patientMatchCandidate.findMany());
    await expect(
      withTenant(app, T.id, (tx) =>
        tx.patientMatchCandidate.update({ where: { id: c?.id }, data: { status: 'merged' } }),
      ),
    ).rejects.toThrow(/patient_match_candidates_decision_valid/);
  });
});

describe('jejak penggabungan', () => {
  it('kelompok rekam medis berjenjang (app_patient_group) dan satu gabungan aktif per rekam medis', async () => {
    const T = await freshTenant();
    const a = await add(T, { name: 'Darmawan', sex: 'male', birthDate: '1962-08-17' });
    const b = await add(T, { name: 'Darmawan S', sex: 'male', birthDate: '1962-08-17' });
    const c = await add(T, { name: 'Tn. X', sex: 'male', unidentified: true });
    const d = await add(T, { name: 'Pasien Lain', sex: 'female', birthDate: '1980-01-01' });
    const merge = (merged: string, survivor: string) =>
      withTenant(app, T.id, async (tx) => {
        await tx.patient.update({
          where: { id: merged },
          data: { status: 'merged', mergedIntoId: survivor, mergedAt: new Date() },
        });
        await tx.patientLink.create({
          data: {
            id: newId(),
            tenantId: T.id,
            survivorId: survivor,
            mergedId: merged,
            reason: 'Dikonfirmasi dengan KTP di loket',
          },
        });
      });
    await merge(b.id, a.id);
    await merge(c.id, b.id);
    const group = (id: string) =>
      withTenant(
        app,
        T.id,
        (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT app_patient_group(${id}::uuid)::text AS id`,
      ).then((rows) => rows.map((r) => r.id).sort());
    const abc = [a.id, b.id, c.id].sort();
    expect(await group(a.id)).toEqual(abc);
    expect(await group(c.id)).toEqual(abc);
    expect(await group(d.id)).toEqual([d.id]);

    await expect(
      withTenant(app, T.id, (tx) =>
        tx.patientLink.create({
          data: {
            id: newId(),
            tenantId: T.id,
            survivorId: d.id,
            mergedId: b.id,
            reason: 'Penggabungan kedua untuk rekam medis yang sama',
          },
        }),
      ),
    ).rejects.toThrow(/patient_links_one_active_per_merged/);
    await expect(
      withTenant(
        app,
        T.id,
        (tx) =>
          tx.$executeRaw`UPDATE patient_links SET reason = 'diubah setelah dicatat' WHERE merged_id = ${b.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
