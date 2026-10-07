import type { CareTeamMember, ConsultRequestRecord } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { apiAnswerBlocker, apiConsultStatus, apiSendBlocker, handoverBlocker } from './konsul-api';

const A = '0199a000-0000-7000-8000-00000000000a';
const B = '0199a000-0000-7000-8000-00000000000b';
const C = '0199a000-0000-7000-8000-00000000000c';
const UNIT = '0199a000-0000-7000-8000-0000000000f1';

type Req = Pick<ConsultRequestRecord, 'state' | 'toUser' | 'toUnit' | 'author'>;
const req = (over: Partial<Req> = {}): Req => ({
  state: 'menunggu',
  toUser: { userId: B, nama: 'dr. Konsultan B' },
  toUnit: null,
  author: { userId: A, nama: 'dr. Pengirim A', peran: 'dokter' },
  ...over,
});
const member = (
  userId: string,
  role: CareTeamMember['role'],
  endedAt: string | null = null,
): CareTeamMember => ({
  id: `${userId}-${role}`,
  user: { userId, nama: userId },
  role,
  startedAt: '2026-10-07T01:00:00.000Z',
  endedAt,
  endReason: null,
});

describe('konsultasi mode api (K10) · aturan tombol', () => {
  it('kirim: dokter/residen, tujuan bukan diri sendiri, pertanyaan ≥ 20 karakter', () => {
    const d = {
      toUserId: B,
      kind: 'konsultasi' as const,
      urgency: 'biasa' as const,
      question: 'x'.repeat(20),
    };
    expect(apiSendBlocker(d, 'dokter', A)).toBeNull();
    expect(apiSendBlocker(d, 'dokter_residen', A)).toBeNull();
    expect(apiSendBlocker(d, 'perawat', A)).toMatch(/dokter/);
    expect(apiSendBlocker({ ...d, toUserId: '' }, 'dokter', A)).toMatch(/Pilih/);
    expect(apiSendBlocker({ ...d, toUserId: A }, 'dokter', A)).toMatch(/diri sendiri/);
    expect(apiSendBlocker({ ...d, question: 'Mohon dicek' }, 'dokter', A)).toMatch(/20 karakter/);
  });

  it('jawab: hanya konsultan tujuan berposisi dokter (atau dokter unit tujuan); bukan pengirim', () => {
    expect(apiAnswerBlocker(req(), { id: B, role: 'dokter', unitId: null })).toBeNull();
    expect(apiAnswerBlocker(req(), { id: C, role: 'dokter', unitId: null })).toMatch(/dokter yang dituju/);
    expect(apiAnswerBlocker(req(), { id: B, role: 'dokter_residen', unitId: null })).toMatch(/posisi dokter/);
    expect(apiAnswerBlocker(req(), { id: A, role: 'dokter', unitId: null })).toMatch(/Pengirim/);
    expect(apiAnswerBlocker(req({ state: 'dijawab' }), { id: B, role: 'dokter', unitId: null })).toMatch(
      /sudah dijawab/,
    );
    const toUnit = req({ toUser: null, toUnit: { id: UNIT, name: 'Poli Jantung' } });
    expect(apiAnswerBlocker(toUnit, { id: C, role: 'dokter', unitId: UNIT })).toBeNull();
    expect(apiAnswerBlocker(toUnit, { id: C, role: 'dokter', unitId: null })).toMatch(/Poli Jantung/);
  });

  it('status batas jawab dan serah DPJP utama', () => {
    const base = { dueAt: '2026-10-07T03:00:00.000Z', responses: [] };
    expect(apiConsultStatus({ ...base, state: 'menunggu' }, '2026-10-07T02:00:00.000Z').tone).toBe('warning');
    expect(apiConsultStatus({ ...base, state: 'menunggu' }, '2026-10-07T04:00:00.000Z').tone).toBe('danger');
    const team = [member(A, 'dpjp_utama'), member(B, 'rawat_bersama')];
    const reason = 'Alih SMF penyakit dalam';
    expect(handoverBlocker(team, { id: A, role: 'dokter' }, C, reason)).toBeNull();
    expect(handoverBlocker(team, { id: B, role: 'dokter' }, C, reason)).toMatch(/DPJP utama aktif/);
    expect(handoverBlocker(team, { id: A, role: 'perawat' }, C, reason)).toMatch(/oleh dokter/);
    expect(handoverBlocker(team, { id: A, role: 'dokter' }, A, reason)).toMatch(/sudah DPJP/);
    expect(handoverBlocker(team, { id: A, role: 'dokter' }, C, 'pendek')).toMatch(/Alasan/);
    expect(
      handoverBlocker(
        [member(A, 'dpjp_utama', '2026-10-07T02:00:00.000Z')],
        { id: B, role: 'dokter' },
        C,
        reason,
      ),
    ).toBeNull();
  });
});
