import type { Grade, SurveyResponse } from '../../pengalaman';
import { shiftDate } from './waktu';

/**
 * B13 · Data dummy pengaduan dan survei (ADR-0023). Kontak pelapor tersamar (disimpan terenkripsi kelak); survei
 * anonim. Data 30 hari terakhir dihitung ulang di layar Mutu: tanggap komplain 87% (20/23) dan indeks kepuasan 86
 * (sama dengan indikator Mutu/Dasbor).
 */

export interface Complaint {
  id: string;
  number: string;
  channel: 'Loket' | 'Telepon' | 'WhatsApp' | 'Aplikasi pasien' | 'Situs web';
  unit: string;
  reporter: string;
  contactMasked: string;
  text: string;
  receivedAt: string;
  grade: Grade | null;
  /** 0 diterima, 1 digrading, 2 tindak lanjut unit tercatat. */
  stage: 0 | 1 | 2;
  actions: ReadonlyArray<{ at: string; by: string; text: string }>;
}

export const OPEN_COMPLAINTS: readonly Complaint[] = [
  {
    id: 'adu-24',
    number: 'ADU-2610-024',
    channel: 'WhatsApp',
    unit: 'IGD',
    reporter: 'Keluarga pasien',
    contactMasked: '0812-0000-77••',
    text: 'Ayah saya menunggu hampir 3 jam di IGD tanpa penjelasan kapan diperiksa dokter.',
    receivedAt: '2026-10-05T07:30:00+07:00',
    grade: null,
    stage: 0,
    actions: [],
  },
  {
    id: 'adu-22',
    number: 'ADU-2610-022',
    channel: 'Loket',
    unit: 'Kasir',
    reporter: 'Pasien rawat jalan',
    contactMasked: '0812-0000-31••',
    text: 'Rincian tagihan tidak dijelaskan dan tampaknya ada obat yang ditagih dua kali.',
    receivedAt: '2026-10-04T10:00:00+07:00',
    grade: 'kuning',
    stage: 1,
    actions: [
      {
        at: '2026-10-04T10:20:00+07:00',
        by: 'Unit pengaduan',
        text: 'Digrading kuning, diteruskan ke kepala kasir',
      },
    ],
  },
  {
    id: 'adu-19',
    number: 'ADU-2610-019',
    channel: 'Aplikasi pasien',
    unit: 'Ruang Melati',
    reporter: 'Pasien rawat inap',
    contactMasked: '0812-0000-58••',
    text: 'AC kamar M-205 meneteskan air ke dekat tempat tidur.',
    receivedAt: '2026-10-01T15:00:00+07:00',
    grade: 'hijau',
    stage: 2,
    actions: [
      { at: '2026-10-01T15:30:00+07:00', by: 'Unit pengaduan', text: 'Digrading hijau, diteruskan ke IPSRS' },
      {
        at: '2026-10-02T09:10:00+07:00',
        by: 'IPSRS',
        text: 'Saluran pembuangan AC dibersihkan, tidak menetes lagi',
      },
    ],
  },
  {
    id: 'adu-16',
    number: 'ADU-2610-016',
    channel: 'Telepon',
    unit: 'Poli Penyakit Dalam',
    reporter: 'Pasien rawat jalan',
    contactMasked: '0812-0000-90••',
    text: 'Dokter datang terlambat satu jam tanpa pemberitahuan kepada pasien yang menunggu.',
    receivedAt: '2026-10-01T09:00:00+07:00',
    grade: 'kuning',
    stage: 1,
    actions: [
      {
        at: '2026-10-01T09:40:00+07:00',
        by: 'Unit pengaduan',
        text: 'Digrading kuning, diteruskan ke kepala instalasi rawat jalan',
      },
    ],
  },
];

/** Pengaduan 30 hari terakhir yang sudah dijawab: 23 kasus, 20 dalam SLA (INM-12 = 87%). */
export function recentComplaints(): Array<{ receivedAt: string; grade: Grade; answeredAt: string }> {
  const grades: Grade[] = ['kuning', 'hijau', 'merah', 'kuning', 'hijau'];
  return Array.from({ length: 23 }, (_, i) => {
    const grade = grades[i % grades.length] ?? 'hijau';
    const day = shiftDate('2026-10-05', -(i + 5));
    const receivedAt = `${day}T09:00:00+07:00`;
    // Tiga kasus terakhir dijawab melewati SLA (SLA + 6 jam); sisanya separuh SLA.
    const late = i >= 20;
    const hours = { merah: 24, kuning: 72, hijau: 168 }[grade] * (late ? 1 : 0.5) + (late ? 6 : 0);
    return {
      receivedAt,
      grade,
      answeredAt: new Date(Date.parse(receivedAt) + hours * 3_600_000).toISOString(),
    };
  });
}

const UNITS = ['Rawat jalan', 'Rawat inap', 'IGD'] as const;
const LOW: Record<number, { aspect: number; comment: string }> = {
  7: { aspect: 1, comment: 'Menunggu dokter terlalu lama, lebih dari dua jam.' },
  23: { aspect: 4, comment: 'Kamar mandi kamar rawat inap kurang bersih.' },
};

/** 50 respons survei pasca-pulang × 5 aspek; indeks 86. */
export function surveyResponses(): SurveyResponse[] {
  let fours = 112;
  return Array.from({ length: 50 }, (_, i) => {
    const low = LOW[i];
    const scores = Array.from({ length: 5 }, (_, a) => {
      if (low && low.aspect === a) return 2;
      if (fours > 0 && !(low && low.aspect === a)) {
        if ((i * 5 + a) % 9 < 4 || 250 - (i * 5 + a) <= fours) {
          fours -= 1;
          return 4;
        }
      }
      return 3;
    });
    return {
      id: `srv-${String(i + 1).padStart(3, '0')}`,
      unit: UNITS[i % UNITS.length] ?? 'Rawat jalan',
      scores,
      comment: low?.comment ?? null,
      submittedAt: `${shiftDate('2026-10-05', -(i % 25))}T1${i % 10}:00:00+07:00`,
    };
  });
}
