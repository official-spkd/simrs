/**
 * P06 · Data rujukan global (skema `ref`): parser CSV, impor gagal-tertutup, pencarian, wilayah, hak baca saja.
 * Impor diuji di dalam transaksi yang dibatalkan di akhir: data rujukan bersama (contoh dari mockup, diisi
 * persiapan tes) tidak berubah untuk tes lain yang berjalan paralel.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  csvRecords,
  importConcepts,
  importRegions,
  listCodeSystems,
  listRegions,
  parseCsv,
  type PrismaClient,
  searchConcepts,
  searchConcepts as search,
} from '../src/index';
import { testDbUrls } from '../src/testing';

let owner: PrismaClient;
let app: PrismaClient;

beforeAll(() => {
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

class Rollback extends Error {}

/** Jalankan `fn` dalam transaksi pemilik tabel lalu batalkan; kembalikan hasil `fn`. */
async function inRolledBackTx<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
) {
  let result: T | undefined;
  await expect(
    owner.$transaction(async (tx) => {
      result = await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
  return result as T;
}

const csv = (text: string) => csvRecords(text).records;

describe('parser CSV', () => {
  it('kutip, koma dan baris baru di dalam kutip, kutip ganda, BOM, CRLF, baris kosong', () => {
    const rows = parseCsv(
      '﻿code,display\r\n"J18.9","Pneumonia, tidak spesifik"\r\n\r\nX,"baris\nkedua ""dikutip"""\n',
    );
    expect(rows).toEqual([
      ['code', 'display'],
      ['J18.9', 'Pneumonia, tidak spesifik'],
      ['X', 'baris\nkedua "dikutip"'],
    ]);
  });

  it('pemisah titik koma (ekspor Excel berlocale Indonesia) dan kutip tak tertutup', () => {
    expect(parseCsv('code;name\n31;DKI\n')).toEqual([
      ['code', 'name'],
      ['31', 'DKI'],
    ]);
    expect(() => parseCsv('code,display\n"J18.9,Pneumonia')).toThrow(/kutip/);
    expect(csvRecords('Code, Display \nI10,Hipertensi').records).toEqual([
      { line: 2, values: { code: 'I10', display: 'Hipertensi' } },
    ]);
  });
});

describe('impor konsep', () => {
  it('perbarui, tetap, nonaktifkan yang tidak ada di berkas (--replace), catat versi', async () => {
    const r = await inRolledBackTx(async (tx) => {
      const report = await importConcepts(
        tx,
        'icd10',
        csv(
          'code,display,active\nJ18.9,"Pneumonia, tidak spesifik (versi uji)",\nI10,Hipertensi esensial (primer),\nK30,Dispepsia,tidak\n',
        ),
        { version: 'uji-2026', source: 'tes', replace: true },
      );
      const [sys] = (await listCodeSystems(tx)).filter((s) => s.id === 'icd10');
      const k30 = await searchConcepts(tx, { system: 'icd10', q: 'K30', limit: 5, includeInactive: true });
      const activeOnly = await searchConcepts(tx, { system: 'icd10', q: 'K30', limit: 5 });
      return { report, sys, k30, activeOnly };
    });
    expect(r.report).toMatchObject({ rows: 3, inserted: 0, updated: 2, unchanged: 1, errors: [] });
    expect(r.report.deactivated).toBeGreaterThan(0);
    expect(r.sys).toMatchObject({ version: 'uji-2026', source: 'tes', conceptCount: 2 });
    expect(r.k30[0]).toMatchObject({ code: 'K30', active: false });
    expect(r.activeOnly).toEqual([]);
  });

  it('gagal tertutup: satu baris salah → tidak ada yang ditulis, semua masalah dilaporkan per baris', async () => {
    const r = await inRolledBackTx(async (tx) => {
      const before = await searchConcepts(tx, { system: 'loinc', q: '718-7', limit: 1 });
      const report = await importConcepts(
        tx,
        'loinc',
        csv(
          'code,display\n718-7,Hemoglobin baru\n718-8,Check digit salah\n2345-7,\n2345-7,Ganda\n2160-0,Kreatinin, serum\n',
        ),
        { version: 'uji' },
      );
      const after = await searchConcepts(tx, { system: 'loinc', q: '718-7', limit: 1 });
      return { before, report, after };
    });
    expect(r.report.errors.map((e) => e.line)).toEqual([3, 4, 6]);
    expect(r.report.errors[0]?.message).toMatch(/718-8.*tidak valid/);
    // Koma di dalam nilai tanpa kutip: baris ditolak, bukan dipotong diam-diam.
    expect(r.report.errors[2]?.message).toMatch(/3 kolom.*2 kolom.*dikutip/);
    expect(r.after[0]?.display).toBe(r.before[0]?.display);

    const dry = await inRolledBackTx((tx) =>
      importConcepts(tx, 'kfa', csv('code,display\n93000387,Klopidogrel uji\n'), {
        version: 'x',
        dryRun: true,
      }),
    );
    expect(dry).toMatchObject({ dryRun: true, errors: [], inserted: 0, updated: 0 });
  });
});

describe('pencarian konsep (contoh dari mockup)', () => {
  it('awalan kode, kata di label, salah ketik, dan wildcard dari pengguna diperlakukan harfiah', async () => {
    // Seperti di API: pencarian berjalan di dalam transaksi (ambang kemiripan per transaksi).
    const searchConcepts = (opts: Parameters<typeof search>[1]) => app.$transaction((tx) => search(tx, opts));
    const code = await searchConcepts({ system: 'icd10', q: 'j18', limit: 5 });
    expect(code[0]).toMatchObject({ code: 'J18.9', display: 'Pneumonia, tidak spesifik' });
    const words = (await searchConcepts({ system: 'icd10', q: 'pneumonia', limit: 10 })).map((c) => c.code);
    expect(words).toEqual(expect.arrayContaining(['J18.9', 'J13']));
    const typo = (await searchConcepts({ system: 'icd10', q: 'pnemonia', limit: 10 })).map((c) => c.code);
    expect(typo).toContain('J18.9');
    expect((await searchConcepts({ system: 'loinc', q: 'hemoglobin', limit: 3 }))[0]?.code).toBe('718-7');
    const kfa = await searchConcepts({ system: 'kfa', q: '93002210', limit: 1 });
    expect(kfa[0]?.extra).toEqual({ high_alert: true });
    expect(await searchConcepts({ system: 'icd10', q: '%', limit: 5 })).toEqual([]);
  });

  it('aplikasi hanya membaca skema ref', async () => {
    await expect(
      app.$executeRaw`INSERT INTO ref.concepts (system, code, display) VALUES ('icd10', 'J18.9', 'x')`,
    ).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`UPDATE ref.concepts SET display = 'x' WHERE code = 'J18.9'`).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$executeRaw`DELETE FROM ref.regions`).rejects.toThrow(/permission denied/);
  });
});

describe('impor wilayah', () => {
  it('tingkat dan induk dari kode; induk harus ada; anak per induk dan cari nama', async () => {
    // Kode 99 tidak dipakai Kemendagri: wilayah fiktif khusus tes.
    const bad = await inRolledBackTx((tx) =>
      importRegions(tx, csv('code,name\n99.01,KABUPATEN FIKTIF\n98.01,TANPA INDUK\n31.7,FORMAT SALAH\n'), {
        version: 'uji',
      }),
    );
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/31\.7.*tidak valid/),
      expect.stringMatching(/induk 99 untuk 99\.01/),
      expect.stringMatching(/induk 98 untuk 98\.01/),
    ]);

    const r = await inRolledBackTx(async (tx) => {
      const report = await importRegions(
        tx,
        csv('code,name\n99.01.01,KECAMATAN FIKTIF\n99,PROVINSI FIKTIF\n99.01,KABUPATEN FIKTIF\n'),
        { version: 'uji' },
      );
      const provinces = await listRegions(tx, { parent: null, limit: 100 });
      const children = await listRegions(tx, { parent: '99', limit: 10 });
      const found = await listRegions(tx, { parent: null, q: 'kecamatan fiktif', limit: 5 });
      return { report, provinces, children, found };
    });
    expect(r.report).toMatchObject({ inserted: 3, errors: [] });
    expect(r.provinces.map((p) => p.code)).toContain('99');
    expect(r.children).toEqual([
      { code: '99.01', name: 'KABUPATEN FIKTIF', level: 'kabupaten', parentCode: '99' },
    ]);
    expect(r.found[0]).toMatchObject({ code: '99.01.01', level: 'kecamatan' });
  });
});
