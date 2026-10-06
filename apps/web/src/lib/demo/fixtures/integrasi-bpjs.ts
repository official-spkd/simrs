import type { BedClassRow, BookingTasks, BpjsService, HfisRow } from '../../integrasi-bpjs';
import { BANGSAL } from './rs';
import { DOKTER } from './staf';
import { DEMO_TODAY } from './waktu';

/**
 * I03 · Data dummy konektor BPJS (ADR-0023). Volume selaras kartu hub (VClaim 1.312, Antrean 7.886); kebijakan retry
 * sama dengan worker (`SERVICE_DAY_RETRY`: sampai akhir hari layanan WIB, jeda maks. 10 menit). Booking 2610050093
 * sama dengan DLQ hub dlq-0072 (task 5 ditolak karena task 4 belum terkirim). Aplicare dari kapasitas bangsal.
 */

const at = (hhmm: string) => `${DEMO_TODAY}T${hhmm.replace('.', ':')}:00+07:00`;
const RETRY =
  'retry eksponensial sampai akhir hari layanan WIB (jeda maks. 10 mnt); penolakan bisnis langsung DLQ';

export const BPJS_SERVICES: readonly BpjsService[] = [
  {
    id: 'vclaim',
    name: 'BPJS VClaim',
    protocol: 'REST · signature HMAC',
    retry: RETRY,
    ops: [
      { name: 'Cek peserta', count: 612, failed: 0, p95Ms: 380 },
      { name: 'Buat SEP', count: 404, failed: 0, p95Ms: 410 },
      { name: 'Rujukan', count: 236, failed: 0, p95Ms: 360 },
      { name: 'Update tanggal pulang', count: 60, failed: 0, p95Ms: 330 },
    ],
    lastError: null,
  },
  {
    id: 'antrean',
    name: 'BPJS Antrean',
    protocol: 'REST · task ID 1–7',
    retry: RETRY,
    ops: [
      { name: 'Tambah antrean', count: 1_142, failed: 0, p95Ms: 260 },
      { name: 'Update waktu (task ID)', count: 6_598, failed: 4, p95Ms: 290 },
      { name: 'Batal antrean', count: 146, failed: 0, p95Ms: 240 },
    ],
    lastError: 'Task 4 belum dikirim untuk kode booking 2610050093 (09.40)',
  },
  {
    id: 'aplicare',
    name: 'BPJS Aplicare',
    protocol: 'REST · ketersediaan tempat tidur',
    retry: RETRY,
    ops: [{ name: 'Update ketersediaan kamar', count: 288, failed: 0, p95Ms: 350 }],
    lastError: null,
  },
  {
    id: 'hfis',
    name: 'BPJS HFIS',
    protocol: 'REST · jadwal dokter',
    retry: RETRY,
    ops: [
      { name: 'Tarik jadwal dokter', count: 24, failed: 0, p95Ms: 1_240 },
      { name: 'Update jadwal dokter', count: 3, failed: 0, p95Ms: 980 },
    ],
    lastError: null,
  },
];

export function demoBookings(): BookingTasks[] {
  const sent = (hhmm: string) => ({ status: 'terkirim' as const, at: at(hhmm) });
  const no = { status: 'belum' as const, at: null };
  return [
    {
      bookingCode: '2610050093',
      patient: 'Ny. Dewi Kurniasih',
      poli: 'Poli Penyakit Dalam · PD-023',
      tasks: {
        1: sent('08.58'),
        2: sent('09.02'),
        3: sent('09.10'),
        4: no,
        5: {
          status: 'gagal',
          at: at('09.40'),
          error: 'metadata 201 · Task 4 belum dikirim untuk kode booking ini',
        },
        6: no,
        7: no,
      },
    },
    {
      bookingCode: '2610050088',
      patient: 'Ny. Sri Wahyuni',
      poli: 'Poli Penyakit Dalam · PD-024',
      tasks: {
        1: sent('09.01'),
        2: sent('09.05'),
        3: sent('09.12'),
        4: sent('09.26'),
        5: sent('09.40'),
        6: sent('09.58'),
        7: no,
      },
    },
    {
      bookingCode: '2610050071',
      patient: 'Tn. Lukman Hakim',
      poli: 'Poli Penyakit Dalam · PD-020',
      tasks: {
        1: sent('08.12'),
        2: sent('08.15'),
        3: sent('08.22'),
        4: sent('08.40'),
        5: sent('09.05'),
        6: sent('09.20'),
        7: sent('09.31'),
      },
    },
  ];
}

/** Ketersediaan per kelas: SIM RS sekarang vs kiriman terakhir ke Aplicare (10.40). Kelas 1 berubah 10.43. */
export function demoBedClasses(): BedClassRow[] {
  const kelas = [...new Set(BANGSAL.map((b) => b.kelas))];
  return kelas.map((k) => {
    const wards = BANGSAL.filter((b) => b.kelas === k);
    const total = wards.reduce((a, b) => a + b.beds, 0);
    const available = wards.reduce((a, b) => a + b.beds - b.occupied, 0);
    return { kelas: k, total, available, reported: k === 'Kelas 1' ? available + 1 : available };
  });
}

export const APLICARE_LAST_SYNC = at('10.40');

const doctor = (name: string) => {
  const d = DOKTER.find((x) => x.nama.startsWith(name));
  if (!d) throw new Error(`Dokter demo ${name} tidak ada`);
  return d.nama;
};

export function demoHfis(): HfisRow[] {
  return [
    {
      doctor: doctor('dr. Andini'),
      poli: 'Penyakit Dalam',
      simrs: 'Sen 08.00–12.00',
      hfis: 'Sen 08.00–12.00',
    },
    {
      doctor: doctor('dr. Rahmat'),
      poli: 'Penyakit Dalam',
      simrs: 'Sen 13.00–16.00',
      hfis: 'Sen 08.00–12.00',
    },
    { doctor: doctor('dr. Bagus'), poli: 'Jantung', simrs: 'Sen 08.00–12.00', hfis: 'Sen 08.00–12.00' },
  ];
}
