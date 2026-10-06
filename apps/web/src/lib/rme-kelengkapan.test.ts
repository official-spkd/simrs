import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import { closeChecklist, patientDocuments } from './demo/fixtures/rme-kelengkapan';
import { rmeChartByEncounter } from './demo/fixtures/rme-pasien';
import {
  cancelBlocker,
  cancelDocument,
  closeBlocker,
  completeness,
  retryTte,
  tteRetryBlocker,
} from './rme-kelengkapan';

const chart = (enc: string) => {
  const c = rmeChartByEncounter(enc);
  if (!c) throw new Error(enc);
  return c;
};

describe('kelengkapan rekam medis dan gerbang tutup kunjungan (K13)', () => {
  it('Ny. Endang: co-sign, edukasi, surat kontrol TTE, resume belum terpenuhi', () => {
    const c = chart(ENCOUNTER_ID.endang);
    const docs = patientDocuments(c);
    const items = closeChecklist(c, docs);
    expect(items.filter((i) => !i.done).map((i) => i.id)).toEqual([
      'cosign',
      'edukasi',
      `tte-${ENCOUNTER_ID.endang}-dok-6`,
      'resume',
    ]);
    expect(completeness(items)).toEqual({ done: 3, total: 7, percent: 43 });
    expect(closeBlocker(items, { role: 'dokter', disposition: 'pulang', documents: docs })).toMatch(
      /^4 butir kelengkapan belum terpenuhi/,
    );
  });

  it('Ny. Rohana (rawat jalan): semua terpenuhi; tutup hanya DPJP dengan disposisi', () => {
    const c = chart(ENCOUNTER_ID.rohana);
    const docs = patientDocuments(c);
    const items = closeChecklist(c, docs);
    expect(items.every((i) => i.done)).toBe(true);
    expect(closeBlocker(items, { role: 'dokter_residen', disposition: 'pulang', documents: docs })).toMatch(
      /DPJP/,
    );
    expect(closeBlocker(items, { role: 'dokter', disposition: '', documents: docs })).toBe(
      'Pilih disposisi pasien.',
    );
    expect(closeBlocker(items, { role: 'dokter', disposition: 'rujuk', documents: docs })).toMatch(
      /surat rujukan/,
    );
    expect(closeBlocker(items, { role: 'dokter', disposition: 'pulang', documents: docs })).toBeNull();
  });

  it('dokumen final terkunci; batal = status dibatalkan beralasan, tidak dihapus', () => {
    const docs = patientDocuments(chart(ENCOUNTER_ID.endang));
    const resep = docs.find((d) => d.title === 'Resep pulang');
    const pindai = docs.find((d) => d.kind === 'Pindaian');
    if (!resep || !pindai) throw new Error('dok');
    expect(cancelBlocker(resep)).toMatch(/addendum/);
    expect(() => cancelDocument(pindai, 'salah', 'x', 'y')).toThrow(/minimal 10/);
    expect(cancelDocument(pindai, 'Dokumen milik pasien lain', 'x', 'y')).toMatchObject({
      status: 'dibatalkan',
      note: 'Dokumen milik pasien lain',
    });
  });

  it('kirim ulang TTE hanya untuk dokumen TTE gagal; dokumen dibatalkan tidak hidup lagi', () => {
    const docs = patientDocuments(chart(ENCOUNTER_ID.endang));
    const failed = docs.find((d) => d.status === 'tte-gagal');
    if (!failed) throw new Error('fixture tanpa TTE gagal');
    expect(tteRetryBlocker(failed)).toBeNull();
    expect(retryTte(failed, 'dr. Andini', '2026-10-05T10:50:00+07:00')).toMatchObject({
      status: 'final-tte',
    });
    const cancelled = cancelDocument(failed, 'Surat kontrol tidak jadi diterbitkan', 'x', 'y');
    expect(tteRetryBlocker(cancelled)).toMatch(/dibatalkan/);
    expect(() => retryTte(cancelled, 'dr. Andini', '2026-10-05T10:50:00+07:00')).toThrow(/dibatalkan/);
  });
});
