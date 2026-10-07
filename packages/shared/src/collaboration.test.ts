import { describe, expect, it } from 'vitest';
import {
  CARE_SETTING_OF_CLASS,
  CONSULT_ANSWER_HOURS,
  consultRequestInputSchema,
  primaryDpjpChangeInputSchema,
} from './index';

const req = {
  encounterId: '0199a000-0000-7000-8000-0000000000aa',
  occurredAt: '2026-10-07T02:00:00.000Z',
  kind: 'konsultasi',
  urgency: 'segera',
  toUserId: '0199a000-0000-7000-8000-0000000000bb',
  toUnitId: null,
  question: 'Mohon evaluasi nyeri dada atipikal pasca operasi',
  revision: { kind: 'baru' },
};

describe('K10 · K15 · kontrak kolaborasi', () => {
  it('konsul wajib tujuan (dokter atau unit) dan pertanyaan klinis ≥ 20 karakter', () => {
    expect(consultRequestInputSchema.safeParse(req).success).toBe(true);
    expect(consultRequestInputSchema.safeParse({ ...req, toUserId: null }).success).toBe(false);
    expect(consultRequestInputSchema.safeParse({ ...req, question: 'Mohon dicek' }).success).toBe(false);
    expect(CONSULT_ANSWER_HOURS).toEqual({ segera: 1, biasa: 24 });
  });

  it('serah DPJP utama wajib alasan ≥ 10; kelas kunjungan → setting paket', () => {
    const userId = '0199a000-0000-7000-8000-0000000000cc';
    expect(primaryDpjpChangeInputSchema.safeParse({ userId, reason: 'pendek' }).success).toBe(false);
    expect(
      primaryDpjpChangeInputSchema.safeParse({ userId, reason: 'Alih SMF penyakit dalam' }).success,
    ).toBe(true);
    expect(CARE_SETTING_OF_CLASS).toEqual({ AMB: 'rawat_jalan', EMER: 'igd', IMP: 'rawat_inap' });
  });
});
