import type { PublicQueue } from '@simrs/shared';
import type { PublicBookingRecord } from '../../info-publik';
import { PATIENT_ID } from './ids';
import { PASIEN } from './pasien';
import { DEMO_NOW } from './waktu';

/**
 * FE1 · F08 data portal publik fiktif. Booking Tn. Darmawan (PD-026, sudah check-in, menunggu di Poli PD) dan
 * Ny. Lestiani (besok). Tanggal lahir diambil dari fixture pasien; nama pasien tidak pernah dikirim ke portal.
 */

const birth = (id: string) => {
  const p = PASIEN.find((x) => x.id === id);
  if (!p) throw new Error('pasien booking publik tidak ada');
  return p.tanggalLahir;
};

export const DEMO_PUBLIC_BOOKINGS: readonly PublicBookingRecord[] = [
  {
    birthDate: birth(PATIENT_ID.darmawan),
    status: {
      bookingCode: '2610050088',
      status: 'checked_in',
      serviceDate: '2026-10-05',
      start: '08:00',
      poliName: 'Poli Penyakit Dalam',
      practitionerName: 'dr. Andini Prameswari, Sp.PD',
      queueNo: 'PD-026',
      currentQueueNo: 'PD-025',
      estimatedAt: '2026-10-05T10:55:00+07:00',
    },
  },
  {
    birthDate: birth(PATIENT_ID.lestiani),
    status: {
      bookingCode: '2610060031',
      status: 'booked',
      serviceDate: '2026-10-06',
      start: '08:00',
      poliName: 'Poli Penyakit Dalam',
      practitionerName: 'dr. Andini Prameswari, Sp.PD',
      queueNo: 'PD-004',
      currentQueueNo: null,
      estimatedAt: '2026-10-06T08:30:00+07:00',
    },
  },
];

/** Contoh yang ditampilkan presenter (kode + tanggal lahir yang cocok). */
export const PUBLIC_BOOKING_HINT = { code: '2610050088', birthDate: birth(PATIENT_ID.darmawan) };

/** Layanan non-poli (loket pendaftaran, farmasi) di antrean publik. */
export const PUBLIC_EXTRA_SERVICES: PublicQueue['services'] = [
  { code: 'A', name: 'Loket pendaftaran', current: 'A-029', waiting: 6, estimatedWaitMinutes: 24 },
  { code: 'F', name: 'Farmasi rawat jalan', current: 'F-018', waiting: 7, estimatedWaitMinutes: 56 },
];

export const PUBLIC_AS_OF = DEMO_NOW;
