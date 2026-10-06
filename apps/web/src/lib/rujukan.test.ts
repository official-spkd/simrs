import { SEED_REF_SAMPLES } from '@simrs/db';
import { bpjsReferenceNumberSchema, REFERRAL_DOC_KINDS } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_REFERRALS } from './demo/fixtures/rujukan';
import { PASIEN } from './demo/fixtures/pasien';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { canCancel, canResend, daysLeft, processSync, referralCounts, resend } from './rujukan';

const ref = (id: string) => {
  const r = DEMO_REFERRALS.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};

describe('F07 · fixture rujukan', () => {
  it('kontrak bersama: jenis baku, nomor hanya setelah terbit, diagnosis dari seed, pasien bukan skenario', () => {
    const icd = new Set(SEED_REF_SAMPLES.icd10.map((c) => c.code));
    for (const r of DEMO_REFERRALS) {
      expect(REFERRAL_DOC_KINDS).toContain(r.kind);
      expect(icd.has(r.diagnosis.code), r.diagnosis.code).toBe(true);
      if (r.number === null) expect(['pending', 'cancelled']).toContain(r.status);
      if (r.number && r.kind !== 'rujukan-internal') {
        expect(bpjsReferenceNumberSchema.safeParse(r.number).success, r.number).toBe(true);
      }
      const p = PASIEN.find((x) => x.id === r.patientId);
      expect(p?.nama).toBe(r.patientName);
      expect(p?.scenario).toBeUndefined();
    }
  });
});

describe('F07 · alur kirim BPJS', () => {
  it('antrean kirim: menunggu → nomor terbit', () => {
    const next = processSync(ref('skt-0045'), '2026-10-05T10:50:00+07:00');
    expect(next).toMatchObject({
      status: 'active',
      number: '0301R0011025K000045',
      sync: { status: 'sent', error: null },
    });
    expect(processSync(next, '2026-10-05T10:51:00+07:00')).toBe(next);
  });

  it('ditolak tanggal: kirim ulang wajib tanggal baru yang berbeda dan tidak lampau', () => {
    const spri = ref('spri-0019');
    expect(canResend(spri, null, DEMO_TODAY)).toEqual({
      ok: false,
      reason: 'Pilih tanggal rencana baru dulu.',
    });
    expect(canResend(spri, '2026-10-04', DEMO_TODAY).ok).toBe(false);
    expect(canResend(spri, '2026-10-01', DEMO_TODAY).ok).toBe(false);
    expect(canResend(spri, '2026-10-06', DEMO_TODAY).ok).toBe(true);
    const again = resend(spri, '2026-10-06', '0301R0011025S000019');
    expect(again.sync.status).toBe('pending');
    expect(processSync(again, '2026-10-05T11:00:00+07:00')).toMatchObject({
      status: 'active',
      plannedDate: '2026-10-06',
    });
  });

  it('DLQ dikirim ulang tanpa tanggal baru; batal ditolak untuk yang sudah dipakai', () => {
    expect(canResend(ref('rk-0007'), null, DEMO_TODAY).ok).toBe(true);
    expect(canCancel(ref('rjk-0412')).ok).toBe(false);
    expect(canCancel(ref('skt-0045')).ok).toBe(true);
    expect(daysLeft(ref('rjk-0388'), DEMO_TODAY)).toBe(3);
    expect(referralCounts(DEMO_REFERRALS)).toEqual({ pending: 1, rejected: 2, active: 2, incomingToday: 1 });
  });
});
