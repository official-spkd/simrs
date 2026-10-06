import { describe, expect, it } from 'vitest';
import { ENCOUNTER_ID } from './demo/fixtures/ids';
import { encounterIdOf } from './demo/fixtures/pasien';
import { careTeam, CONSULTANTS, CONSULTS } from './demo/fixtures/rme-konsul';
import { rmeChartByEncounter } from './demo/fixtures/rme-pasien';
import {
  activeTeam,
  answerBlocker,
  answerDueAt,
  applyFollowUp,
  type ConsultAnswer,
  type ConsultRequest,
  consultantAccessUntil,
  consultStatus,
  primaryDoctor,
  sendBlocker,
} from './rme-konsul';

const NOW = '2026-10-05T10:45:00+07:00';
const sutan = CONSULTS[0] as ConsultRequest;
const answer = (followUp: ConsultAnswer['followUp']): ConsultAnswer => ({
  findings: '',
  conclusion: 'CKD stadium 3',
  recommendation: 'Hidrasi pra-kontras',
  followUp,
  by: 'dr. Konsultan',
  at: '2026-10-05T10:50:00+07:00',
});

describe('konsultasi dan rawat bersama (K10)', () => {
  it('fixture: konsul PD cito Tn. Sutan belum dijawab dan lewat batas 1 jam', () => {
    for (const c of CONSULTS) expect(encounterIdOf(c.patientId)).toBe(c.encounterId);
    expect(sutan.encounterId).toBe(ENCOUNTER_ID.sutan);
    expect(answerDueAt(sutan)).toBe('2026-10-05T03:30:00.000Z');
    expect(consultStatus(sutan, NOW)).toEqual({ text: 'Belum dijawab · lewat batas 10.30', tone: 'danger' });
    expect(CONSULTANTS.some((c) => c.specialty === 'Penyakit dalam')).toBe(true);
  });

  it('kirim konsul: dokter, konsultan bukan diri sendiri, pertanyaan ≥ 20 karakter', () => {
    const d = {
      to: 'dr. B',
      kind: 'sekali' as const,
      urgency: 'cito' as const,
      question: 'Mohon evaluasi fungsi ginjal pra-kontras',
    };
    expect(sendBlocker(d, 'dokter', 'dr. A')).toBeNull();
    expect(sendBlocker(d, 'perawat', 'dr. A')).toMatch(/dokter/);
    expect(sendBlocker({ ...d, to: '' }, 'dokter', 'dr. A')).toMatch(/Pilih dokter/);
    expect(sendBlocker(d, 'dokter', 'dr. B')).toMatch(/diri sendiri/);
    expect(sendBlocker({ ...d, question: 'singkat' }, 'dokter', 'dr. A')).toMatch(/20 karakter/);
  });

  it('jawab konsul: hanya posisi dokter, kesimpulan + rekomendasi wajib', () => {
    const a = { conclusion: 'x', recommendation: 'y' };
    const me = sutan.to;
    expect(answerBlocker(sutan, a, 'dokter', me)).toBeNull();
    expect(answerBlocker(sutan, a, 'dokter_residen', me)).toMatch(/residen menyiapkan draf/);
    expect(answerBlocker(sutan, { ...a, recommendation: ' ' }, 'dokter', me)).toMatch(/rekomendasi/);
    expect(answerBlocker({ ...sutan, answer: answer('selesai') }, a, 'dokter', me)).toBe(
      'Konsul sudah dijawab.',
    );
    // Hanya dokter yang dituju yang menjawab: bukan dokter lain, bukan pengirim konsul (alih rawat ke diri sendiri).
    expect(answerBlocker(sutan, a, 'dokter', 'dr. Lain Fiktif, Sp.B')).toMatch(/dokter yang dituju/);
    expect(answerBlocker({ ...sutan, from: me }, a, 'dokter', me)).toMatch(/Pengirim konsul/);
  });

  it('tindak lanjut: rawat bersama menambah anggota; alih rawat menutup DPJP lama (bukan menghapus)', () => {
    const chart = rmeChartByEncounter(ENCOUNTER_ID.sutan);
    if (!chart) throw new Error('chart');
    const team = careTeam(chart);
    expect(primaryDoctor(team)).toBe(chart.dpjp);
    const rb = applyFollowUp(team, sutan, answer('rawat-bersama'), 'n1');
    expect(activeTeam(rb).map((m) => m.role)).toEqual(['dpjp-utama', 'rawat-bersama']);
    const alih = applyFollowUp(team, sutan, answer('alih-rawat'), 'n1');
    expect(alih).toHaveLength(2);
    expect(alih[0]?.until).toBe('2026-10-05T10:50:00+07:00');
    expect(primaryDoctor(alih)).toBe('dr. Konsultan');
    expect(applyFollowUp(team, sutan, answer('selesai'), 'n1')).toEqual(team);
  });

  it('akses konsultan berbatas waktu', () => {
    expect(consultantAccessUntil(sutan)).toBe('2026-10-06T02:30:00.000Z');
    expect(consultantAccessUntil({ ...sutan, answer: answer('selesai') })).toBe('2026-10-06T03:50:00.000Z');
    expect(consultantAccessUntil({ ...sutan, answer: answer('rawat-bersama') })).toBeNull();
  });
});
