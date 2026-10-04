/**
 * P05 · Lapisan database MPI: enkripsi tersimpan, pencarian trigram, batasan, hak kolom, FK, dan isolasi tenant.
 * Aturan bisnis (izin, NIK ganda, audit) diuji di apps/api.
 */
import { newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, insertPatient, type PrismaClient, withTenant } from '../src/index';
import { testDbUrls } from '../src/testing';

// Kunci uji khusus tes ini (bukan .env): yang diuji lapisan database, bukan konfigurasi. Karena kuncinya beda
// dari API/E2E, pasien uji hanya dibuat di tenant baru, tidak pernah di tenant seed bersama (RSFA/RSFB).
const keys = {
  encKeyB64: Buffer.alloc(32, 11).toString('base64'),
  hashKeyB64: Buffer.alloc(32, 13).toString('base64'),
};
let app: PrismaClient;
let owner: PrismaClient;
const A = { id: '' };
const B = { id: '' };

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 5 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  A.id = await freshTenant();
  B.id = await freshTenant();
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const tag = () => newId().slice(-6);

async function freshTenant(): Promise<string> {
  const id = newId();
  await withTenant(owner, id, (tx) =>
    tx.tenant.create({ data: { id, code: `MPI${tag().toUpperCase()}`, name: 'RS Fiktif Uji MPI' } }),
  );
  return id;
}

describe('pasien (P05) di database', () => {
  it('insertPatient: nomor RM berformat, NIK/kontak tersimpan terenkripsi + hash', async () => {
    const crypto = new PatientCrypto(keys, A.id);
    const nik = '9999015403720001';
    const p = await withTenant(app, A.id, (tx) =>
      insertPatient(tx, crypto, {
        name: 'Siti Rahmawati',
        sex: 'female',
        birthDate: '1972-03-14',
        address: 'Jl. Kenanga No. 12, Jakarta Timur',
        phone: '6281200004567',
        identifiers: { nik, bpjs: '0000012345678' },
      }),
    );
    expect(p.mrn).toMatch(/^\d{2}-\d{2}-\d{2}-\d{2}$/);
    const [row] = await withTenant(
      app,
      A.id,
      (tx) =>
        tx.$queryRaw<
          Array<{ name_search: string; address_enc: string; phone_enc: string; birth_date: string }>
        >`
        SELECT name_search, address_enc, phone_enc, birth_date::text FROM patients WHERE id = ${p.id}::uuid`,
    );
    expect(row?.name_search).toBe('siti rahmawati');
    expect(row?.birth_date).toBe('1972-03-14');
    expect(row?.address_enc).not.toContain('Kenanga');
    expect(row?.phone_enc).not.toContain('4567');
    expect(crypto.decryptContact(row?.address_enc ?? '')).toBe('Jl. Kenanga No. 12, Jakarta Timur');

    const ids = await withTenant(app, A.id, (tx) =>
      tx.patientIdentifier.findMany({ where: { patientId: p.id }, orderBy: { system: 'asc' } }),
    );
    expect(ids.map((i) => i.system)).toEqual(['bpjs', 'nik']);
    const nikRow = ids.find((i) => i.system === 'nik');
    expect(nikRow?.valueEnc).not.toContain(nik);
    expect(nikRow?.valueHash).toBe(crypto.identifierHash('nik', nik));
    expect(nikRow?.verificationStatus).toBe('unverified');
  });

  it('pencarian trigram menemukan ejaan berbeda; tenant lain tidak melihat apa pun', async () => {
    const T = await freshTenant();
    const crypto = new PatientCrypto(keys, T);
    await withTenant(app, T, async (tx) => {
      for (const name of ['Siti Rahmawati', 'Budi Santoso', 'Rina Wulandari'])
        await insertPatient(tx, crypto, { name, sex: 'female', birthDate: '1980-01-01' });
    });
    const found = await withTenant(
      app,
      T,
      (tx) =>
        tx.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM patients
        WHERE name_search % ${'siti rachmawati'} OR ${'siti rachmawati'} <% name_search
        ORDER BY similarity(name_search, ${'siti rachmawati'}) DESC`,
    );
    expect(found.map((r) => r.name)).toEqual(['Siti Rahmawati']);
    const other = await withTenant(app, B.id, (tx) => tx.patient.count({ where: { tenantId: T } }));
    expect(other).toBe(0);
  });

  it('batasan: kolom terenkripsi menolak teks biasa; satu identifier aktif per sistem; status gabung konsisten', async () => {
    const crypto = new PatientCrypto(keys, A.id);
    const p = await withTenant(app, A.id, (tx) =>
      insertPatient(tx, crypto, {
        name: 'Budi Santoso',
        sex: 'male',
        birthDate: '1965-06-02',
        identifiers: { nik: '9999010206650001' },
      }),
    );
    await expect(
      withTenant(app, A.id, (tx) =>
        tx.patientIdentifier.create({
          data: {
            id: newId(),
            tenantId: A.id,
            patientId: p.id,
            system: 'bpjs',
            valueEnc: '0000012345678',
            valueHash: 'a'.repeat(64),
          },
        }),
      ),
    ).rejects.toThrow(/patient_identifiers_encrypted/);
    await expect(
      withTenant(app, A.id, (tx) =>
        tx.patientIdentifier.create({
          data: {
            id: newId(),
            tenantId: A.id,
            patientId: p.id,
            system: 'nik',
            ...crypto.encryptIdentifier('nik', '9999010206650099'),
          },
        }),
      ),
    ).rejects.toThrow(/patient_identifiers_one_active_per_system/);
    await expect(
      withTenant(app, A.id, (tx) => tx.patient.update({ where: { id: p.id }, data: { status: 'merged' } })),
    ).rejects.toThrow(/patients_merge_consistent/);
    await expect(
      withTenant(app, A.id, (tx) =>
        tx.patient.update({ where: { id: p.id }, data: { phoneEnc: '081200004567' } }),
      ),
    ).rejects.toThrow(/patients_encrypted_columns/);
  });

  it('role aplikasi tidak bisa mengubah nomor RM atau nilai identifier, dan tidak bisa menghapus', async () => {
    const crypto = new PatientCrypto(keys, A.id);
    const p = await withTenant(app, A.id, (tx) =>
      insertPatient(tx, crypto, {
        name: 'Rina Wulandari',
        sex: 'female',
        birthDate: '1990-05-05',
        identifiers: { paspor: 'A1234567' },
      }),
    );
    await expect(
      withTenant(
        app,
        A.id,
        (tx) => tx.$executeRaw`UPDATE patients SET mrn = '99-99-99-99' WHERE id = ${p.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(
        app,
        A.id,
        (tx) =>
          tx.$executeRaw`UPDATE patient_identifiers SET value_hash = ${'b'.repeat(64)} WHERE patient_id = ${p.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(app, A.id, (tx) => tx.$executeRaw`DELETE FROM patients WHERE id = ${p.id}::uuid`),
    ).rejects.toThrow(/permission denied/);
  });

  it('FK: relasi dan akses darurat hanya untuk pasien yang ada di tenant yang sama', async () => {
    const crypto = new PatientCrypto(keys, B.id);
    const pB = await withTenant(app, B.id, (tx) =>
      insertPatient(tx, crypto, { name: 'Pasien RS B', sex: 'male', birthDate: '1970-01-01' }),
    );
    const userId = await withTenant(app, A.id, async (tx) => {
      const u = await tx.user.create({
        data: { id: newId(), tenantId: A.id, username: `fk.${tag()}`, displayName: 'Uji FK' },
      });
      return u.id;
    });
    for (const patientId of [newId(), pB.id]) {
      await expect(
        withTenant(app, A.id, (tx) =>
          tx.accessRelationship.create({
            data: { id: newId(), tenantId: A.id, userId, patientId, kind: 'dpjp' },
          }),
        ),
      ).rejects.toThrow(/access_relationships_tenant_id_patient_id_fkey/);
      await expect(
        withTenant(app, A.id, (tx) =>
          tx.breakGlassGrant.create({
            data: {
              id: newId(),
              tenantId: A.id,
              userId,
              patientId,
              reason: 'Pasien tidak sadar di IGD, butuh riwayat alergi',
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }),
        ),
      ).rejects.toThrow(/break_glass_grants_tenant_id_patient_id_fkey/);
    }
  });
});
