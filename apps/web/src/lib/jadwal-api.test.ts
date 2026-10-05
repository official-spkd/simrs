import type { WeeklySchedule } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  hfisSummary,
  leaveTransferNote,
  leavesWithPatients,
  mondayOf,
  quotaEquals,
  requestedWeek,
} from './jadwal-api';

const base: WeeklySchedule = {
  weekStart: '2026-10-05',
  days: ['2026-10-05'],
  doctors: [],
  hfis: { lastSyncAt: null, differences: [] },
};
const SLOT = '11111111-1111-4111-8111-111111111111';

describe('minggu jadwal', () => {
  it('Senin dari tanggal mana pun; parameter tidak sah → minggu hari ini', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(requestedWeek('2026-10-14', '2026-10-05')).toBe('2026-10-12');
    expect(requestedWeek('kemarin', '2026-10-07')).toBe('2026-10-05');
    expect(requestedWeek(undefined, '2026-10-07')).toBe('2026-10-05');
  });
});

describe('ringkasan HFIS', () => {
  it('belum ditarik → minta tarik dulu', () => {
    expect(hfisSummary(base)).toMatchObject({ pending: true, label: 'HFIS belum ditarik' });
  });

  it('tanpa perbedaan → tersinkron dengan jam tarikan WIB', () => {
    expect(
      hfisSummary({ ...base, hfis: { lastSyncAt: '2026-10-05T00:30:00.000Z', differences: [] } }),
    ).toEqual({
      pending: false,
      label: 'Tersinkron HFIS 07.30',
      text: '',
      needsHfisApp: false,
      needsPush: false,
    });
  });

  it('perbedaan: aplikasi HFIS vs kirim dibedakan', () => {
    const s = hfisSummary({
      ...base,
      hfis: {
        lastSyncAt: '2026-10-05T00:30:00.000Z',
        differences: [
          { slotId: SLOT, text: 'Cuti belum di HFIS.', resolution: 'aplikasi-hfis' },
          { slotId: SLOT, text: 'Jam beda.', resolution: 'kirim' },
        ],
      },
    });
    expect(s).toMatchObject({
      pending: true,
      label: 'Sinkron HFIS 07.30 · 2 perbedaan',
      text: 'Cuti belum di HFIS. Jam beda.',
      needsHfisApp: true,
      needsPush: true,
    });
  });
});

describe('cuti berpasien', () => {
  it('hanya cuti dengan pasien booking, beserta pengganti', () => {
    const cuti = {
      id: SLOT,
      sessionId: '22222222-2222-4222-8222-222222222222',
      date: '2026-10-07',
      kind: 'cuti' as const,
      start: null,
      end: null,
      quota: null,
      relatedDoctorId: 'melati',
      affectedPatients: 3,
      hfisSynced: false,
    };
    const doc = (id: string, slots: WeeklySchedule['doctors'][number]['slots']) => ({
      id,
      name: id,
      poliCode: 'JT',
      poliName: 'Jantung',
      room: 'Ruang 4',
      slots,
    });
    const sched: WeeklySchedule = {
      ...base,
      days: ['2026-10-07'],
      doctors: [
        doc('bagus', [cuti]),
        doc('melati', [
          { ...cuti, kind: 'libur', sessionId: null, relatedDoctorId: null, affectedPatients: null },
        ]),
        doc('kosong', [{ ...cuti, affectedPatients: 0 }]),
      ],
    };
    const leaves = leavesWithPatients(sched);
    expect(leaves.map((l) => [l.doctor.id, l.substitute?.id])).toEqual([['bagus', 'melati']]);

    // Sudah dialihkan: tetap disertakan (kartu "sudah dialihkan") tetapi di belakang yang belum.
    const done = { ...cuti, transferredAt: '2026-10-05T02:15:00.000Z' };
    const mixed: WeeklySchedule = {
      ...sched,
      doctors: [doc('bagus', [done]), doc('yudha', [cuti]), doc('melati', sched.doctors[1]?.slots ?? [])],
    };
    expect(leavesWithPatients(mixed).map((l) => l.doctor.id)).toEqual(['yudha', 'bagus']);
    expect(leaveTransferNote(done, 'dr. Melati')).toBe(
      'Pasien sudah dialihkan ke dr. Melati · 09.15. Notifikasi WhatsApp tidak dikirim ulang.',
    );
    expect(leaveTransferNote(cuti, 'dr. Melati')).toBeNull();
  });

  it('kuota sama hanya bila JKN dan non-JKN sama', () => {
    const q = { jkn: 24, nonJkn: 6, bookedJkn: 1, bookedNonJkn: 0 };
    expect(quotaEquals(q, { ...q, bookedJkn: 5 })).toBe(true);
    expect(quotaEquals(q, { ...q, nonJkn: 5 })).toBe(false);
    expect(quotaEquals(q, null)).toBe(false);
  });
});
