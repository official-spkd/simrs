import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { type PatientAppEvent, patientAppDomain } from './aplikasi-pasien-toko';
import { doctorAppDomain } from './aplikasi-dokter-toko';
import { project, type StoredEvent } from './demo/store/define';
import { COSIGN_NOTES } from './demo/fixtures/manajemen';
import { readbackMatches } from './manajemen-aplikasi';

const pasien = actor('u-p', 'perawat', 'Perawat Uji');
const booking: PatientAppEvent = {
  type: 'booking.dibuat',
  code: 'BK-2610-041',
  patientId: 'p',
  slotId: 'slot-1',
  doctorId: 'd',
  doctorName: 'dr. Uji',
  poliCode: 'PD',
  poliName: 'Poli Penyakit Dalam',
  date: '2026-10-07',
  start: '08.00',
  jam: '10.50',
};

describe('I07 · domain toko aplikasi pasien', () => {
  it('kode booking berurutan, tidak ganda; cuti di Jadwal dokter menandai booking', () => {
    const s = applyAll(patientAppDomain, [[booking, pasien]]);
    expect(s.seq).toBe(42);
    expect(denied(patientAppDomain, s, { ...booking, code: 'BK-2610-042' }, pasien)).toMatch(/sudah booking/);
    const cuti: StoredEvent = {
      seq: 2,
      domain: 'jadwal',
      at: '2026-10-05T03:50:00.000Z',
      actor: pasien,
      data: { type: 'cuti.dicatat', slotId: 'slot-1', substituteId: null, reason: 'Seminar nasional', jam: '10.55' },
    };
    const book: StoredEvent = { seq: 1, domain: 'aplikasi-pasien', at: cuti.at, actor: pasien, data: booking };
    const after = project(patientAppDomain, { seq: 2, resetSeq: 0, events: [book, cuti] }).state;
    expect(after.bookings[0]?.onLeave).toBe(true);
    expect(denied(patientAppDomain, after, { ...booking, code: 'BK-2610-042' }, pasien)).toMatch(/cuti/);
  });

  it('akses keluarga: setuju sekali, cabut tercatat', () => {
    const s = applyAll(patientAppDomain, [
      [{ type: 'keluarga.disetujui', scopes: ['jadwal', 'lab'], duration: '30', until: '2026-11-04', jam: '10.00' }, pasien],
      [{ type: 'keluarga.dicabut', name: 'Ny. Ratih Nugroho', jam: '10.01' }, pasien],
    ]);
    expect(s.family.grants.map((g) => g.name)).toEqual(['Bayu Nugroho']);
    expect(denied(patientAppDomain, s, { type: 'keluarga.ditolak', jam: '10.02' }, pasien)).toMatch(/menunggu/);
  });
});

describe('I08 · aplikasi dokter', () => {
  it('read-back cocok angka atau teks lengkap', () => {
    expect(readbackMatches('6,4 mmol/L', '6,4')).toBe(true);
    expect(readbackMatches('6,4 mmol/L', '6.4 mmol/l')).toBe(true);
    expect(readbackMatches('6,4 mmol/L', '6,8')).toBe(false);
    expect(readbackMatches('Batang Gram negatif', 'batang gram negatif')).toBe(true);
  });

  it('co-sign hanya posisi Dokter; sekali per CPPT', () => {
    const n = COSIGN_NOTES[0];
    if (!n) throw new Error('fixture');
    const sign = { type: 'cosign.ditandatangani' as const, noteId: n.id, patientName: n.patientName, rm: n.rm, jam: '10.00' };
    expect(denied(doctorAppDomain, { signed: {}, notes: {} }, sign, actor('u-r', 'dokter_residen'))).toMatch(/Dokter/);
    const s = applyAll(doctorAppDomain, [[sign, actor('u-d', 'dokter', 'dr. DPJP Uji')]]);
    expect(s.signed[n.id]?.by).toBe('dr. DPJP Uji');
    expect(denied(doctorAppDomain, s, sign, actor('u-d', 'dokter'))).toMatch(/sudah/);
  });
});
