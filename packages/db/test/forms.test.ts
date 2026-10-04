/**
 * P07 · Penjaga database form engine: isian append-only (trigger, juga bagi pemilik tabel), isi versi terbit
 * tidak bisa diubah, satu versi berlaku per kode, rantai versi isian konsisten.
 */
import { MORSE_FALL_SCALE, newId } from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  ensurePublishedForm,
  insertPatient,
  type PrismaClient,
  withTenant,
} from '../src/index';
import { testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;
let T: string;
let patientId: string;
let definitionId: string;

beforeAll(async () => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 3 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  T = newId();
  await withTenant(owner, T, (tx) =>
    tx.tenant.create({
      data: { id: T, code: `FM${T.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Formulir' },
    }),
  );
  const crypto = new PatientCrypto(
    {
      encKeyB64: Buffer.alloc(32, 31).toString('base64'),
      hashKeyB64: Buffer.alloc(32, 37).toString('base64'),
    },
    T,
  );
  patientId = (
    await withTenant(app, T, (tx) =>
      insertPatient(tx, crypto, { name: 'Pasien Formulir', sex: 'female', birthDate: '1980-01-01' }),
    )
  ).id;
  definitionId = (await withTenant(app, T, (tx) => ensurePublishedForm(tx, T, MORSE_FALL_SCALE))).id;
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const response = (over: Record<string, unknown> = {}) => {
  const id = newId();
  return {
    id,
    rootId: id,
    tenantId: T,
    patientId,
    definitionId,
    formCode: 'morse_dewasa',
    version: 1,
    answers: { q_riwayat_jatuh: 'tidak' },
    ...over,
  };
};

describe('form engine di database (P07)', () => {
  it('isian tidak bisa diubah atau dihapus, bahkan oleh pemilik tabel', async () => {
    const r = response();
    await withTenant(app, T, (tx) => tx.formResponse.create({ data: r }));
    await expect(
      withTenant(app, T, (tx) => tx.formResponse.update({ where: { id: r.id }, data: { score: 99 } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(
        owner,
        T,
        (tx) => tx.$executeRaw`UPDATE form_responses SET score = 99 WHERE id = ${r.id}::uuid`,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
    await expect(
      withTenant(owner, T, (tx) => tx.$executeRaw`DELETE FROM form_responses WHERE id = ${r.id}::uuid`),
    ).rejects.toThrow(/APPEND_ONLY/);
  });

  it('rantai versi: koreksi wajib beralasan dan satu versi hanya digantikan sekali', async () => {
    const v1 = response();
    await withTenant(app, T, (tx) => tx.formResponse.create({ data: v1 }));
    await expect(
      withTenant(app, T, (tx) =>
        tx.formResponse.create({ data: { ...response(), rootId: v1.id, version: 2, supersedesId: v1.id } }),
      ),
    ).rejects.toThrow(/form_responses_version_chain/);
    const v2 = {
      ...response(),
      rootId: v1.id,
      version: 2,
      supersedesId: v1.id,
      correctionReason: 'Salah pilih saat entri awal',
    };
    await withTenant(app, T, (tx) => tx.formResponse.create({ data: v2 }));
    await expect(
      withTenant(app, T, (tx) =>
        tx.formResponse.create({
          data: {
            ...response(),
            rootId: v1.id,
            version: 3,
            supersedesId: v1.id,
            correctionReason: 'Koreksi ganda',
          },
        }),
      ),
    ).rejects.toThrow(/form_responses_supersedes_once/);
    const current = await withTenant(
      app,
      T,
      (tx) =>
        tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id::text FROM form_responses_current WHERE root_id = ${v1.id}::uuid`,
    );
    expect(current).toEqual([{ id: v2.id }]);
  });

  it('pasang formulir pustaka paralel (seed/E2E): tepat satu v1, tanpa unique violation', async () => {
    const T2 = newId();
    await withTenant(owner, T2, (tx) =>
      tx.tenant.create({
        data: { id: T2, code: `FP${T2.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Seed Paralel' },
      }),
    );
    // Delapan transaksi serentak (seperti proyek E2E desktop + tablet). Tanpa kunci, balapan cek-lalu-sisip ini
    // muncul sporadis sebagai unique violation; dengan kunci siklus formulir, selalu tepat satu yang membuat v1.
    const wide = createPrismaClient({ connectionString: testDbUrls().app, max: 8 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        withTenant(wide, T2, (tx) => ensurePublishedForm(tx, T2, MORSE_FALL_SCALE)),
      ),
    );
    await wide.$disconnect();
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });

  it('isi versi terbit tidak bisa diubah; arsip boleh; satu versi berlaku per kode', async () => {
    await expect(
      withTenant(app, T, (tx) =>
        tx.formDefinition.update({ where: { id: definitionId }, data: { title: 'Judul diubah diam-diam' } }),
      ),
    ).rejects.toThrow(/FORM_DEFINITION_IMMUTABLE/);
    // Semua kolom versi terbit beku, termasuk catatan perubahan dan jejak terbit (bukan hanya isi formulir).
    await expect(
      withTenant(app, T, (tx) =>
        tx.formDefinition.update({ where: { id: definitionId }, data: { changeNote: 'Catatan diubah' } }),
      ),
    ).rejects.toThrow(/FORM_DEFINITION_IMMUTABLE/);
    await expect(
      withTenant(app, T, (tx) =>
        tx.formDefinition.update({ where: { id: definitionId }, data: { publishedAt: new Date(0) } }),
      ),
    ).rejects.toThrow(/FORM_DEFINITION_IMMUTABLE/);
    const now = new Date();
    await expect(
      withTenant(app, T, (tx) =>
        tx.formDefinition.create({
          data: {
            id: newId(),
            tenantId: T,
            code: 'morse_dewasa',
            version: 2,
            title: 'Versi dua',
            category: 'keperawatan',
            status: 'published',
            schema: MORSE_FALL_SCALE.schema,
            writeRoles: ['perawat'],
            changeNote: 'Uji',
            submittedAt: now,
            publishedAt: now,
          },
        }),
      ),
    ).rejects.toThrow(/form_definitions_one_published/);
    await withTenant(app, T, (tx) =>
      tx.formDefinition.update({
        where: { id: definitionId },
        data: { status: 'archived', archivedAt: now },
      }),
    );
    await expect(
      withTenant(app, T, (tx) =>
        tx.formDefinition.update({ where: { id: definitionId }, data: { status: 'published' } }),
      ),
    ).rejects.toThrow(/FORM_DEFINITION_IMMUTABLE/);
    await expect(
      withTenant(app, T, (tx) =>
        tx.formDefinition.update({ where: { id: definitionId }, data: { archivedAt: new Date(0) } }),
      ),
    ).rejects.toThrow(/FORM_DEFINITION_IMMUTABLE/);
  });
});
