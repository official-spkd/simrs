import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import { EDU_RECORDS, REQUIRED_TOPICS, requiredTopics } from './demo/fixtures/rme-edukasi';
import { rmeChartByEncounter } from './demo/fixtures/rme-pasien';
import {
  consentReady,
  type EduDraft,
  eduBlocker,
  EMPTY_EDU,
  type EduRecord,
  professionOf,
  topicCoverage,
} from './rme-edukasi';

const ok: EduDraft = {
  ...EMPTY_EDU,
  topics: ['insulin'],
  methods: ['demonstrasi'],
  recipient: 'keluarga',
  recipientName: 'Sdr. Dimas Wijaya',
  understanding: 'paham',
  teachBack: 'Suntik glargine 16 unit jam 10 malam di perut.',
  signature: 'dimas wijaya',
  attested: true,
};

describe('edukasi terintegrasi (K11)', () => {
  it('gerbang: materi, metode, penerima, verifikasi, tanda tangan, atestasi', () => {
    expect(eduBlocker(ok)).toBeNull();
    expect(eduBlocker({ ...ok, topics: [] })).toMatch(/materi/);
    expect(eduBlocker({ ...ok, methods: [] })).toMatch(/metode/);
    expect(eduBlocker({ ...ok, understanding: '' })).toMatch(/verifikasi pemahaman/);
    expect(eduBlocker({ ...ok, teachBack: 'ya' })).toMatch(/teach-back/);
    expect(eduBlocker({ ...ok, understanding: 'perlu-diulang', teachBack: '' })).toMatch(/jadwalkan/);
    expect(
      eduBlocker({ ...ok, understanding: 'perlu-diulang', repeatAt: '2026-10-05T12:00:00+07:00' }),
    ).toBeNull();
    expect(eduBlocker({ ...ok, signature: 'Budi' })).toMatch(/Tanda tangan/);
    expect(eduBlocker({ ...ok, attested: false })).toMatch(/atestasi/);
  });

  it('cakupan materi wajib Ny. Endang: penyakit/diet/obat paham, jatuh diulang, insulin/pulang belum', () => {
    const recs = EDU_RECORDS[ENCOUNTER_ID.endang] ?? [];
    const cov = topicCoverage(recs, REQUIRED_TOPICS[ENCOUNTER_ID.endang] ?? []);
    expect(cov).toEqual({
      paham: ['penyakit', 'diet', 'obat'],
      ulang: ['jatuh'],
      belum: ['insulin', 'pulang'],
    });
  });

  it('edukasi ulang terbaru menggantikan status materi; persetujuan siap setelah edukasi tindakan paham', () => {
    const r = (understanding: EduRecord['understanding'], at: string): EduRecord => ({
      id: at,
      topics: ['tindakan'],
      methods: ['lisan'],
      educator: 'x',
      profession: 'Bidan',
      recipient: 'pasien',
      recipientName: 'Ny. A',
      understanding,
      teachBack: '',
      repeatAt: null,
      signature: 'A',
      at,
    });
    expect(consentReady([r('perlu-diulang', '2026-10-05T09:00:00+07:00')])).toBe(false);
    expect(
      consentReady([
        r('perlu-diulang', '2026-10-05T09:00:00+07:00'),
        r('paham', '2026-10-05T09:30:00+07:00'),
      ]),
    ).toBe(true);
    expect(consentReady(EDU_RECORDS[ENCOUNTER_ID.sutan] ?? [])).toBe(true);
  });

  it('materi wajib per setting dan profesi edukator', () => {
    const anisa = rmeChartByEncounter(ENCOUNTER_ID.anisa);
    const dewi = rmeChartByEncounter(ENCOUNTER_ID.dewi);
    if (!anisa || !dewi) throw new Error('chart');
    expect(requiredTopics(anisa)).toContain('tindakan');
    expect(requiredTopics(dewi)).toEqual(['penyakit', 'obat']);
    expect(professionOf('bidan')).toBe('Bidan');
    expect(professionOf('perawat')).toBe('Perawat');
  });
});
