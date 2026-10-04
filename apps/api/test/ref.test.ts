/**
 * P06 · API data rujukan (hanya baca): sistem kode beserta versinya, pencarian konsep, ambil satu kode,
 * wilayah per induk, dan izin `ref.read`. Konsep = contoh dari mockup yang diisi persiapan tes.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createPrismaClient, csvRecords, importRegions } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createTestUser, login, TENANT_A, type Tokens } from './helpers';

let app: NestExpressApplication;
const tok: Record<string, Tokens> = {};
const get = (who: string, url: string) =>
  request(app.getHttpServer())
    .get(url)
    .set(bearer(tok[who] as Tokens));

beforeAll(async () => {
  app = await createTestApp();
  tok.rm = await login(app, await createTestUser(TENANT_A, { roles: [{ code: 'petugas_rm' }] }));
  tok.akuntan = await login(app, await createTestUser(TENANT_A, { roles: [{ code: 'akuntan' }] }));
  // Wilayah fiktif (kode 97 tidak dipakai Kemendagri), idempoten: impor ulang hanya memperbarui.
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    await owner.$transaction((tx) =>
      importRegions(
        tx,
        csvRecords('code,name\n97,PROVINSI FIKTIF UJI\n97.01,KOTA FIKTIF UJI\n97.02,KABUPATEN FIKTIF UJI\n')
          .records,
        { version: 'uji' },
      ),
    );
  } finally {
    await owner.$disconnect();
  }
});

afterAll(async () => {
  await app.close();
});

describe('data rujukan (P06)', () => {
  it('daftar sistem kode beserta versi dataset', async () => {
    const res = await get('rm', '/api/v1/ref/systems').expect(200);
    const icd10 = res.body.find((s: { id: string }) => s.id === 'icd10');
    expect(icd10).toMatchObject({
      label: 'ICD-10',
      uri: 'http://hl7.org/fhir/sid/icd-10',
      version: 'contoh-mockup',
    });
    expect(icd10.conceptCount).toBeGreaterThanOrEqual(29);
  });

  it('cari: awalan kode, kata di label (tahan salah ketik), per sistem; parameter divalidasi', async () => {
    const byCode = await get('rm', '/api/v1/ref/concepts?system=icd10&q=j18').expect(200);
    expect(byCode.body[0]).toMatchObject({ system: 'icd10', code: 'J18.9', active: true });
    const typo = await get('rm', '/api/v1/ref/concepts?system=icd10&q=pnemonia').expect(200);
    expect(typo.body.map((c: { code: string }) => c.code)).toContain('J18.9');
    const lab = await get('rm', '/api/v1/ref/concepts?system=loinc&q=kreatinin').expect(200);
    expect(lab.body[0]).toMatchObject({ code: '2160-0', display: 'Kreatinin' });
    await get('rm', '/api/v1/ref/concepts?system=snomed&q=x').expect(400);
    await get('rm', '/api/v1/ref/concepts?system=icd10&q=').expect(400);
  });

  it('ambil satu kode; kode yang belum diimpor → 404', async () => {
    const res = await get('rm', '/api/v1/ref/concepts/kfa/93000914').expect(200);
    expect(res.body).toMatchObject({ display: 'Atorvastatin 40 mg tablet', extra: { fornas: true } });
    await get('rm', '/api/v1/ref/concepts/icd10/i10').expect(200);
    await get('rm', '/api/v1/ref/concepts/icd10/Z99.9').expect(404);
  });

  it('wilayah: anak per induk dan cari nama', async () => {
    const provinces = await get('rm', '/api/v1/ref/regions').expect(200);
    expect(provinces.body.map((r: { code: string }) => r.code)).toContain('97');
    const children = await get('rm', '/api/v1/ref/regions?parent=97').expect(200);
    expect(children.body.map((r: { code: string }) => r.code)).toEqual(['97.01', '97.02']);
    const found = await get('rm', '/api/v1/ref/regions?q=kota%20fiktif').expect(200);
    expect(found.body[0]).toMatchObject({ code: '97.01', level: 'kabupaten', parentCode: '97' });
    await get('rm', '/api/v1/ref/regions?parent=9').expect(400);
  });

  it('peran tanpa izin rujukan ditolak', async () => {
    await get('akuntan', '/api/v1/ref/concepts?system=icd10&q=j18').expect(403);
  });
});
