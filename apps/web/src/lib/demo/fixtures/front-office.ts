import type {
  CounterTicket,
  PractitionerQuota,
  QueueBoard,
  QueueBoardClinic,
  Referral,
  RegistrationDesk,
  RegistrationPatient,
  ScheduleDoctor,
  ScheduleSlot,
  WeeklySchedule,
} from '@simrs/shared';
import { type DemoPatient, patientById } from './pasien';
import { poliByCode, queueNo } from './rs';
import { doctorById } from './staf';
import { DEMO_NOW, DEMO_TODAY, shiftDate } from './waktu';

/**
 * Data dummy front office (F01 jadwal, F03/F06 pendaftaran + SEP, F04 papan antrean, F05 anjungan; ADR-0023).
 * Semua fiktif dan memakai fixture bersama (PASIEN, DOKTER, POLI). Pasien skenario rawat jalan (Tn. Suryo)
 * diproyeksikan lewat `FrontOfficeProgress` agar jadwal, loket, dan papan antrean mengikuti kemajuan Simulasi.
 */

/** Kemajuan Tn. Suryo (skenario rawat jalan) yang tampak di layar front office. */
export interface FrontOfficeProgress {
  /** `kedatangan.tiket`: tiket loket A-031 tercetak di anjungan. */
  ticket: boolean;
  /** `pendaftaran.panggil`: dipanggil ke loket 3. */
  called: boolean;
  /** `pendaftaran.sep`: SEP terbit, antrean poli PD-027. */
  sep: boolean;
  /** `pemeriksaan-dokter.panggil`: PD-027 dipanggil ke ruang periksa 2. */
  doctorCalled: boolean;
}

export const NO_PROGRESS: FrontOfficeProgress = {
  ticket: false,
  called: false,
  sep: false,
  doctorCalled: false,
};

/** Identitas tetap pasien skenario rawat jalan di front office (naskah Simulasi). */
export const SCENARIO_RJ = {
  patientId: 'ps-suryo',
  bookingCode: '2610050117',
  ticket: 'A-031',
  sep: '0301R0011026V005102',
  poliQueue: 'PD-027',
  doctorId: 'dr-andini',
  diagnosis: 'E11.9 · Diabetes melitus tipe 2 tanpa komplikasi',
} as const;

/** Pasien bawaan meja pendaftaran dan anjungan di luar skenario. */
export const DEFAULT_PATIENT_ID = 'ps-siti';
/** Nomor SEP fiktif untuk pendaftaran lokal (format VClaim, bukan nomor nyata). */
export const LOCAL_SEP = '0301R0011026V000812';

/** Hari jadwal: Senin 5 – Sabtu 10 Okt 2026. */
export const SCHEDULE_DAYS = Array.from({ length: 6 }, (_, i) => shiftDate(DEMO_TODAY, i));

type Practice = readonly [
  start: string,
  end: string,
  jkn: number,
  nonJkn: number,
  bJkn: number,
  bNon: number,
];
type Cell =
  Practice | 'libur' | { cuti: string; patients: number } | { pengganti: string; start: string; end: string };

/** Jadwal mingguan (mockup Jadwal): kuota bawaan 80% JKN / 20% non-JKN, booking per penjamin. */
const WEEK: ReadonlyArray<readonly [doctorId: string, cells: readonly Cell[]]> = [
  [
    'dr-andini',
    [
      ['08.00', '12.00', 24, 6, 17, 5],
      ['08.00', '12.00', 24, 6, 21, 5],
      ['08.00', '12.00', 24, 6, 10, 2],
      ['08.00', '12.00', 24, 6, 7, 2],
      'libur',
      ['08.00', '11.00', 16, 4, 4, 1],
    ],
  ],
  [
    'dr-rahmat',
    [
      ['13.00', '16.00', 20, 5, 7, 2],
      'libur',
      ['13.00', '16.00', 20, 5, 16, 4],
      ['13.00', '16.00', 20, 5, 3, 1],
      ['13.00', '16.00', 20, 5, 2, 0],
      'libur',
    ],
  ],
  [
    'dr-bagus',
    [
      ['09.00', '12.00', 16, 4, 16, 2],
      ['09.00', '12.00', 16, 4, 9, 2],
      { cuti: 'dr-melati', patients: 18 },
      ['09.00', '12.00', 16, 4, 6, 1],
      ['09.00', '12.00', 16, 4, 5, 1],
      'libur',
    ],
  ],
  [
    'dr-melati',
    [
      'libur',
      ['13.00', '15.00', 12, 3, 5, 1],
      { pengganti: 'dr-bagus', start: '09.00', end: '12.00' },
      ['13.00', '15.00', 12, 3, 3, 0],
      'libur',
      ['08.00', '10.00', 8, 2, 1, 0],
    ],
  ],
  [
    'dr-yudha',
    [
      ['09.30', '12.00', 16, 4, 12, 3],
      ['09.30', '12.00', 16, 4, 14, 3],
      ['09.30', '12.00', 16, 4, 8, 2],
      'libur',
      ['09.30', '12.00', 16, 4, 6, 2],
      'libur',
    ],
  ],
  [
    'dr-kartika',
    [
      ['08.00', '11.00', 16, 4, 11, 3],
      ['08.00', '11.00', 16, 4, 7, 2],
      ['08.00', '11.00', 16, 4, 13, 3],
      ['08.00', '11.00', 16, 4, 4, 1],
      ['08.00', '11.00', 16, 4, 3, 1],
      ['08.00', '10.00', 8, 2, 2, 0],
    ],
  ],
];

function doctorOf(id: string) {
  const d = doctorById(id);
  const poli = d?.poli ? poliByCode(d.poli) : undefined;
  if (!d || !poli) throw new Error(`Dokter poli ${id} tidak ada di fixture bersama`);
  return { d, poli };
}

function slotOf(doctorId: string, date: string, cell: Cell, hfisSynced: boolean): ScheduleSlot {
  const base = { id: `${doctorId}.${date}`, date, relatedDoctorId: null, affectedPatients: null, hfisSynced };
  if (cell === 'libur') return { ...base, kind: 'libur', start: null, end: null, quota: null };
  if (Array.isArray(cell)) {
    const [start, end, jkn, nonJkn, bookedJkn, bookedNonJkn] = cell as Practice;
    return { ...base, kind: 'praktik', start, end, quota: { jkn, nonJkn, bookedJkn, bookedNonJkn } };
  }
  if ('cuti' in cell) {
    return {
      ...base,
      kind: 'cuti',
      start: null,
      end: null,
      quota: null,
      relatedDoctorId: cell.cuti,
      affectedPatients: cell.patients,
    };
  }
  const p = cell as { pengganti: string; start: string; end: string };
  return {
    ...base,
    kind: 'pengganti',
    start: p.start,
    end: p.end,
    quota: null,
    relatedDoctorId: p.pengganti,
  };
}

/** Slot cuti yang belum dikirim ke HFIS (satu-satunya perbedaan jadwal RS vs HFIS pagi ini). */
export const HFIS_PENDING_SLOT = `dr-bagus.${shiftDate(DEMO_TODAY, 2)}`;

/** F01 · Jadwal minggu 5–10 Okt 2026. Setelah SEP Tn. Suryo terbit, slot Senin dr. Andini bertambah satu booking. */
export function demoWeeklySchedule(p: FrontOfficeProgress = NO_PROGRESS): WeeklySchedule {
  const doctors: ScheduleDoctor[] = WEEK.map(([id, cells]) => {
    const { d, poli } = doctorOf(id);
    const slots = cells.map((cell, i) => {
      const date = SCHEDULE_DAYS[i] ?? DEMO_TODAY;
      const slot = slotOf(id, date, cell, `${id}.${date}` !== HFIS_PENDING_SLOT);
      if (p.sep && id === SCENARIO_RJ.doctorId && date === DEMO_TODAY && slot.quota) {
        return { ...slot, quota: { ...slot.quota, bookedJkn: slot.quota.bookedJkn + 1 } };
      }
      return slot;
    });
    return { id, name: d.nama, poliCode: poli.code, poliName: poli.name, room: poli.room, slots };
  });
  const bagus = doctorOf('dr-bagus').d.nama;
  return {
    weekStart: DEMO_TODAY,
    days: SCHEDULE_DAYS,
    doctors,
    hfis: {
      lastSyncAt: `${DEMO_TODAY}T07:30:00+07:00`,
      differences: [
        {
          slotId: HFIS_PENDING_SLOT,
          text: `${bagus} masih tercatat praktik Rabu 7 Okt 09.00–12.00 di HFIS, padahal cuti di jadwal RS. Pasien Mobile JKN bisa salah booking.`,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// F04 · Papan antrean rawat jalan lantai 2
// ---------------------------------------------------------------------------------------------------------------

const range = (code: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => queueNo(code, from + i));

function boardClinic(
  doctorId: string,
  current: string,
  waiting: string[],
  note: string,
  extra: Partial<QueueBoardClinic> = {},
): QueueBoardClinic {
  const { d, poli } = doctorOf(doctorId);
  return {
    poliCode: poli.code,
    poliName: poli.name,
    room: poli.room,
    doctorName: d.nama,
    current,
    waiting,
    reserved: [],
    note,
    noteTone: 'normal',
    ...extra,
  };
}

/**
 * F04 · Papan antrean. PD-027 (Tn. Suryo, booking aplikasi) dicadangkan: muncul sebagai "berikutnya" setelah SEP
 * terbit dan baru dipanggil ketika DPJP memanggilnya (`pemeriksaan-dokter.panggil`), tidak oleh panggilan otomatis.
 */
export function demoQueueBoard(p: FrontOfficeProgress = NO_PROGRESS): QueueBoard {
  const pd = p.doctorCalled
    ? boardClinic('dr-andini', SCENARIO_RJ.poliQueue, range('PD', 28, 31), 'Estimasi 12 menit per pasien')
    : boardClinic(
        'dr-andini',
        'PD-025',
        p.sep ? range('PD', 26, 31) : ['PD-026', ...range('PD', 28, 31)],
        'Estimasi 12 menit per pasien',
        { reserved: [SCENARIO_RJ.poliQueue] },
      );
  const clinics = [
    pd,
    boardClinic('dr-bagus', 'JT-009', range('JT', 10, 13), 'Estimasi 15 menit per pasien'),
    boardClinic('dr-yudha', 'SR-004', range('SR', 5, 7), 'Dokter mulai praktik 09.30', {
      noteTone: 'perhatian',
    }),
    boardClinic('dr-kartika', 'PR-011', range('PR', 12, 14), 'Estimasi 10 menit per pasien'),
  ];
  const earlier = [
    { queueNo: 'PR-011', poliCode: 'PR' },
    { queueNo: 'SR-004', poliCode: 'SR' },
    { queueNo: 'JT-009', poliCode: 'JT' },
  ];
  return {
    area: 'Rawat Jalan Lantai 2',
    asOf: DEMO_NOW,
    calling: { queueNo: pd.current ?? 'PD-025', poliCode: 'PD' },
    history: [...earlier, { queueNo: p.doctorCalled ? 'PD-026' : 'PD-024', poliCode: 'PD' }],
    clinics,
    info: 'Tidak mendengar panggilan? Cek nomor Anda di aplikasi atau Mobile JKN. Nomor yang terlewat dipanggil ulang setelah 3 pasien berikutnya.',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// F03/F06 · Meja pendaftaran (loket 3)
// ---------------------------------------------------------------------------------------------------------------

/** Kode ICD-10 dari contoh seed (`SEED_REF_SAMPLES`, label sama dengan seed; dijaga tes). */
const ICD = {
  I10: 'Hipertensi esensial (primer)',
  'E11.9': 'Diabetes melitus tipe 2 tanpa komplikasi',
  'J18.9': 'Pneumonia, tidak spesifik',
  K30: 'Dispepsia',
} as const;
const dx = (code: keyof typeof ICD) => ({ code, label: ICD[code] });

/** Nomor antrean poli berikutnya dan perkiraan panggil per dokter yang praktik hari ini. */
const TODAY_QUEUE: Record<string, { next: number; eta: string }> = {
  'dr-andini': { next: 32, eta: '11.20' },
  'dr-rahmat': { next: 110, eta: '13.40' },
  'dr-bagus': { next: 14, eta: '11.30' },
  'dr-yudha': { next: 8, eta: '11.15' },
  'dr-kartika': { next: 15, eta: '10.50' },
};

/** Kuota dokter hari ini = slot Senin di jadwal mingguan (satu sumber), ditambah nomor antrean berikutnya. */
export function todayQuotas(schedule: WeeklySchedule): PractitionerQuota[] {
  return schedule.doctors.flatMap((doc) => {
    const slot = doc.slots.find((s) => s.date === DEMO_TODAY);
    const q = TODAY_QUEUE[doc.id];
    if (!slot?.quota || !slot.start || !slot.end || !q) return [];
    return [
      {
        doctorId: doc.id,
        doctorName: doc.name,
        poliCode: doc.poliCode,
        poliName: doc.poliName,
        room: doc.room,
        start: slot.start,
        end: slot.end,
        jkn: { booked: slot.quota.bookedJkn, total: slot.quota.jkn },
        nonJkn: { booked: slot.quota.bookedNonJkn, total: slot.quota.nonJkn },
        nextQueueNo: queueNo(doc.poliCode, q.next),
        eta: q.eta,
      },
    ];
  });
}

const mask = (phone: string) => phone.replace(/^(\d{4})-\d{4}-(\d{4})$/, '$1-••••-$2');

function lookupOf(
  id: string,
  extra: Pick<RegistrationPatient, 'guardian' | 'lastVisit' | 'referrals'> & {
    fktp?: string;
    segment?: string;
  },
): RegistrationPatient {
  const p: DemoPatient | undefined = patientById(id);
  if (!p) throw new Error(`Pasien ${id} tidak ada di fixture bersama`);
  const bpjs = p.penjamin === 'BPJS' && p.bpjsMasked && p.kelas;
  return {
    id: p.id,
    rm: p.rm,
    name: p.nama,
    sex: p.jk,
    birthDate: p.tanggalLahir,
    ageYears: p.umur,
    nikMasked: p.nikMasked,
    bpjsMasked: p.bpjsMasked,
    phoneMasked: mask(p.telepon),
    address: p.alamat,
    guardian: extra.guardian,
    lastVisit: extra.lastVisit,
    identityVerified: true,
    defaultPayer: p.penjamin,
    eligibility:
      bpjs && p.bpjsMasked && p.kelas
        ? {
            status: 'aktif',
            cardMasked: p.bpjsMasked,
            kelas: p.kelas,
            segment: extra.segment ?? 'PBPU',
            fktp: extra.fktp ?? 'Puskesmas Sukamaju',
          }
        : null,
    referrals: extra.referrals,
  };
}

function referral(
  r: Omit<Referral, 'visitNo' | 'doctorId'> & Partial<Pick<Referral, 'visitNo' | 'doctorId'>>,
) {
  return { visitNo: null, doctorId: null, ...r } satisfies Referral;
}

/** Pasien yang bisa dicari di meja pendaftaran (di luar skenario). Siti Rahmawati = pasien bawaan. */
export function registrationPatients(): RegistrationPatient[] {
  return [
    lookupOf(DEFAULT_PATIENT_ID, {
      guardian: 'Andi (anak)',
      lastVisit: '12 Sep 2026 · Poli Penyakit Dalam',
      referrals: [
        referral({
          id: 'rj-siti-kontrol',
          kind: 'surat-kontrol',
          number: '0301R0011025K000456',
          title: 'Surat kontrol · Poli Penyakit Dalam',
          origin: 'Poli Penyakit Dalam',
          diagnosis: dx('I10'),
          issuedAt: '2026-09-12',
          validUntil: '2026-10-12',
          poliCode: 'PD',
          doctorId: 'dr-andini',
        }),
        referral({
          id: 'rj-siti-fktp',
          kind: 'rujukan-fktp',
          number: '0301U0420926P001234',
          title: 'Rujukan FKTP · Puskesmas Sukamaju',
          origin: 'Puskesmas Sukamaju',
          diagnosis: dx('I10'),
          issuedAt: '2026-09-28',
          validUntil: '2026-12-28',
          visitNo: 3,
          poliCode: 'PD',
        }),
        referral({
          id: 'rj-siti-lama',
          kind: 'rujukan-fktp',
          number: '0301U0510626P000877',
          title: 'Rujukan FKTP · Klinik Pratama Sehat Sentosa',
          origin: 'Klinik Pratama Sehat Sentosa',
          diagnosis: dx('K30'),
          issuedAt: '2026-06-01',
          validUntil: '2026-09-01',
          visitNo: 2,
          poliCode: 'PD',
        }),
      ],
    }),
    lookupOf('ps-endang', {
      guardian: 'Budi (suami)',
      lastVisit: '21 Sep 2026 · Poli Paru',
      fktp: 'Klinik Pratama Harapan Sehat',
      referrals: [
        referral({
          id: 'rj-endang-kontrol',
          kind: 'surat-kontrol',
          number: '0301R0011025K000502',
          title: 'Surat kontrol · Poli Paru',
          origin: 'Poli Paru',
          diagnosis: dx('J18.9'),
          issuedAt: '2026-09-21',
          validUntil: '2026-10-19',
          poliCode: 'PR',
          doctorId: 'dr-kartika',
        }),
      ],
    }),
    lookupOf('ps-ayu', { guardian: 'Dimas (suami)', lastVisit: '2 Agu 2026 · IGD', referrals: [] }),
    lookupOf('ps-fajar', { guardian: 'Laras (istri)', lastVisit: '3 Jul 2026 · Poli Bedah', referrals: [] }),
  ];
}

/** Tn. Suryo di meja pendaftaran (skenario rawat jalan): surat kontrol Poli PD, DPJP dr. Andini, dx E11.9. */
export function scenarioRegistrationPatient(): RegistrationPatient {
  return lookupOf(SCENARIO_RJ.patientId, {
    guardian: 'Wati (istri)',
    lastVisit: '14 Sep 2026 · Poli Penyakit Dalam',
    referrals: [
      referral({
        id: 'rj-suryo-kontrol',
        kind: 'surat-kontrol',
        number: '0301R0011025K000117',
        title: 'Surat kontrol · Poli Penyakit Dalam',
        origin: 'Poli Penyakit Dalam',
        diagnosis: dx('E11.9'),
        issuedAt: '2026-09-14',
        validUntil: '2026-10-12',
        poliCode: 'PD',
        doctorId: SCENARIO_RJ.doctorId,
      }),
    ],
  });
}

/** Tiket loket admisi berikutnya. A-031 milik Tn. Suryo (dicetak di anjungan) sehingga tidak dipakai walk-in. */
export function counterTickets(p: FrontOfficeProgress): CounterTicket[] {
  const walkIn = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ ticket: queueNo('A', from + i), patientId: null }));
  if (!p.ticket) return walkIn(28, 30);
  if (!p.called) return [{ ticket: SCENARIO_RJ.ticket, patientId: SCENARIO_RJ.patientId }, ...walkIn(32, 33)];
  return walkIn(32, 34);
}

/** F03/F06 · Meja pendaftaran loket 3: antrean loket, kuota dokter hari ini, dan pasien yang bisa dicari. */
export function demoRegistrationDesk(p: FrontOfficeProgress = NO_PROGRESS): RegistrationDesk {
  const tickets = counterTickets(p);
  return {
    date: DEMO_TODAY,
    counter: { name: 'Loket 3', waiting: 11 + tickets.length, tickets },
    vclaimLatencyMs: 320,
    quotas: todayQuotas(demoWeeklySchedule(p)),
    patients: registrationPatients(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// F05 · Anjungan pendaftaran mandiri (lokal, di luar skenario: Siti Rahmawati)
// ---------------------------------------------------------------------------------------------------------------

/** Tiket anjungan lokal per tujuan (mockup Anjungan): booking/BPJS A-016, umum A-017, farmasi F-021. */
export const KIOSK_TICKETS = {
  bpjs: { no: 'A-016', eta: '09.35' },
  umum: { no: 'A-017', eta: '09.47' },
  farmasi: { no: 'F-021', eta: '10.05' },
} as const;
