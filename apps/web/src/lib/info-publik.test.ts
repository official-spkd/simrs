import { publicBookingStatusSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { demoQueueBoard, demoWeeklySchedule, todayQuotas } from './demo/fixtures/front-office';
import {
  DEMO_PUBLIC_BOOKINGS,
  PUBLIC_BOOKING_HINT,
  PUBLIC_EXTRA_SERVICES,
} from './demo/fixtures/info-publik';
import { PASIEN } from './demo/fixtures/pasien';
import { DEMO_NOW, DEMO_TODAY } from './demo/fixtures/waktu';
import { lookupBooking, MAX_ATTEMPTS, publicQueueFrom, publicScheduleFrom } from './info-publik';

describe('F08 · portal informasi publik', () => {
  it('jadwal dan antrean publik lolos kontrak gateway; sisa kuota = total − terisi', () => {
    const quotas = todayQuotas(demoWeeklySchedule());
    const schedule = publicScheduleFrom(quotas, DEMO_TODAY, DEMO_NOW);
    expect(schedule.sessions).toHaveLength(quotas.length);
    const q0 = quotas[0];
    if (!q0) throw new Error('kuota kosong');
    expect(schedule.sessions[0]?.remaining.jkn).toBe(q0.jkn.total - q0.jkn.booked);
    const queue = publicQueueFrom(demoQueueBoard(), PUBLIC_EXTRA_SERVICES, 8);
    const pd = queue.services.find((s) => s.code === 'PD');
    expect(pd?.estimatedWaitMinutes).toBe((pd?.waiting ?? 0) * 8);
  });

  it('booking publik tanpa PHI (tidak ada nama di kontrak) dan nomor konsisten dengan roster Poli PD', () => {
    const names = PASIEN.map((p) => p.nama.toLowerCase());
    for (const b of DEMO_PUBLIC_BOOKINGS) {
      expect(publicBookingStatusSchema.safeParse(b.status).success).toBe(true);
      const json = JSON.stringify(b.status).toLowerCase();
      for (const n of names) expect(json.includes(n)).toBe(false);
    }
    const pd = demoQueueBoard().clinics.find((c) => c.poliCode === 'PD');
    expect(DEMO_PUBLIC_BOOKINGS[0]?.status.currentQueueNo).toBe(pd?.current);
  });

  it('cek booking: cocok, tidak cocok dijawab sama, format salah tidak dihitung, blok setelah 5 kali', () => {
    const { code, birthDate } = PUBLIC_BOOKING_HINT;
    expect(lookupBooking(DEMO_PUBLIC_BOOKINGS, code, birthDate, 0).kind).toBe('found');
    const wrongDob = lookupBooking(DEMO_PUBLIC_BOOKINGS, code, '1979-01-26', 0);
    const wrongCode = lookupBooking(DEMO_PUBLIC_BOOKINGS, '2610059999', birthDate, 0);
    expect(wrongDob).toEqual(wrongCode);
    expect(wrongDob).toEqual({ kind: 'not-found', attemptsLeft: MAX_ATTEMPTS - 1 });
    expect(lookupBooking(DEMO_PUBLIC_BOOKINGS, '123', birthDate, 0).kind).toBe('invalid');
    expect(lookupBooking(DEMO_PUBLIC_BOOKINGS, code, birthDate, MAX_ATTEMPTS)).toEqual({ kind: 'blocked' });
  });
});
