import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { DATASET_REQUEST } from './demo/fixtures/dataset-riset';
import { type DatasetEvent, datasetDomain, initialDataset } from './dataset-riset-toko';

const when = '2026-10-05T03:50:00.000Z';
const privasiA = actor('u-pa', 'petugas_privasi', 'Privasi A');
const privasiB = actor('u-pb', 'petugas_privasi', 'Privasi B');
const direktur = actor('u-dir', 'manajemen', 'Direktur Uji');

const safeRules = {
  name: 'hapus',
  rm: 'pseudonim',
  nik: 'hapus',
  phone: 'hapus',
  age: 'generalisasi',
  sex: 'pertahankan',
  district: 'hapus',
  hba1c: 'pertahankan',
  episodes: 'pertahankan',
  insulin: 'pertahankan',
} as const;

const steps = (): Array<readonly [DatasetEvent, ReturnType<typeof actor>]> => [
  [{ type: 'etik.dicatat', number: 'KEPK/031/2026', until: '2027-09-30', when }, privasiA],
  [{ type: 'deid.diterapkan', rules: { ...safeRules }, when }, privasiA],
];

describe('I11 · domain toko dataset riset', () => {
  it('etik berlaku wajib; de-identifikasi dihitung ulang (k-anonimitas) di toko', () => {
    expect(
      denied(datasetDomain, initialDataset(), { type: 'etik.dicatat', number: 'KEPK/1/26', until: '2026-01-01', when }, privasiA),
    ).toMatch(/tidak berlaku/);
    const s = applyAll(datasetDomain, steps().slice(0, 1));
    const leaky = { ...safeRules, age: 'pertahankan', district: 'pertahankan' } as const;
    expect(denied(datasetDomain, s, { type: 'deid.diterapkan', rules: { ...leaky }, when }, privasiA)).toMatch(
      /k-anonimitas/,
    );
  });

  it('penyetuju rilis: petugas privasi, bukan penyusun de-identifikasi (ID sesi), bukan pemohon', () => {
    const s = applyAll(datasetDomain, steps());
    const approve: DatasetEvent = { type: 'rilis.disetujui', when };
    expect(s.deidBy?.name).toBe('Privasi A');
    expect(denied(datasetDomain, s, approve, privasiA)).toMatch(/pemisahan tugas/);
    expect(denied(datasetDomain, s, approve, direktur)).toMatch(/Petugas privasi/);
    expect(
      denied(datasetDomain, s, approve, actor('u-req', 'petugas_privasi', DATASET_REQUEST.requester)),
    ).toMatch(/pemohon/);
    const done = applyAll(datasetDomain, [
      ...steps(),
      [approve, privasiB],
      [{ type: 'dataset.diekstrak', when }, privasiA],
      [{ type: 'dataset.diunduh', when }, privasiA],
    ]);
    expect(done.stage).toBe(5);
    expect(done.log.at(-1)?.action).toMatch(/mengunduh dataset/);
  });
});
