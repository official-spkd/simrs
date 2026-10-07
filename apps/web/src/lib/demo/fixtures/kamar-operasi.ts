import type { OrRoom } from '@simrs/shared';
import { wib } from './btn';
import { DOCTOR_ID, OR_CASE_ID, PATIENT_ID } from './ids';
import { patientById } from './pasien';
import { DOKTER, STAF_LAIN } from './staf';

/**
 * S06 · Data dummy kamar operasi (mockup `OK`; ADR-0023): jadwal kamar, kasus dengan daftar tilik WHO, hitung kasa, dan
 * kasus pasien skenario Ny. Ratna Sari. Dipisah dari fixture TPDI × BTN (rencana fase 4 potongan 4.0c, layar OK pindah
 * dari namespace `btn`). Id kasus opak di `OR_CASE_ID`; pasien dari `PASIEN`, staf dari `DOKTER`/`STAF_LAIN`.
 */

type OrCase = OrRoom['cases'][number];
type Phase = OrCase['checklist'][number];

/** Butir daftar tilik keselamatan operasi WHO per fase (5 butir). */
export const CHECKLIST_LABELS: Record<Phase['phase'], readonly string[]> = {
  'sign-in': [
    'Identitas, lokasi, prosedur dikonfirmasi pasien',
    'Penandaan lokasi operasi',
    'Mesin dan obat anestesi dicek',
    'Pulse oksimetri terpasang',
    'Risiko jalan napas sulit / aspirasi dinilai',
  ],
  'time-out': [
    'Semua anggota tim memperkenalkan diri',
    'Nama pasien, prosedur, lokasi insisi',
    'Antibiotik profilaksis ≤ 60 mnt sebelum insisi',
    'Antisipasi kejadian kritis (bedah, anestesi, perawat)',
    'Pencitraan penting ditampilkan',
  ],
  'sign-out': [
    'Nama prosedur yang dicatat',
    'Hitung kasa, jarum, instrumen lengkap',
    'Label spesimen',
    'Masalah alat',
    'Rencana pemulihan',
  ],
};

const hm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}.${String(min % 60).padStart(2, '0')}`;

function phase(
  id: Phase['phase'],
  checked: readonly boolean[],
  confirmedMin: number | null,
  by: string,
  labels: readonly string[] = CHECKLIST_LABELS[id],
): Phase {
  return {
    phase: id,
    items: labels.map((label, i) => ({ id: `${id}-${i + 1}`, label, checked: checked[i] ?? false })),
    confirmedAt: confirmedMin === null ? null : wib(hm(confirmedMin)),
    confirmedBy: confirmedMin === null ? null : by,
  };
}

const ALL = [true, true, true, true, true] as const;
const NONE = [false, false, false, false, false] as const;

const NURSE = STAF_LAIN.perawat;
const doctorName = (id: string) => {
  const d = DOKTER.find((x) => x.id === id);
  if (!d) throw new Error(`Dokter fiktif ${id} tidak ada`);
  return d.nama;
};

function counts(setLabel: string, final: boolean): OrCase['counts'] {
  const rows: Array<[string, string, string, number]> = [
    ['kb', 'Kasa besar', 'lembar', 20],
    ['kk', 'Kasa kecil', 'lembar', 30],
    ['jr', 'Jarum', 'buah', 6],
    ['set', setLabel, 'set', 1],
  ];
  return rows.map(([id, label, unit, initial]) => ({
    id,
    label,
    unit,
    initial,
    final: final ? initial : null,
  }));
}

interface CaseSeed {
  id: string;
  patientId: string;
  startMin: number;
  durationMin: number;
  status: OrCase['status'];
  statusNote: string;
  procedure: string;
  icd9cm: string | null;
  diagnosis: OrCase['diagnosis'];
  operator: string;
  anesthesia: string;
  scrub: string;
  setLabel: string;
}

function orCase(s: CaseSeed): OrCase {
  const p = patientById(s.patientId);
  if (!p) throw new Error(`Pasien fiktif ${s.patientId} tidak ada`);
  const circulating = NURSE[0];
  const done = s.status === 'selesai';
  const started = done || s.status === 'berjalan';
  const end = s.startMin + s.durationMin;
  return {
    id: s.id,
    startMin: s.startMin,
    durationMin: s.durationMin,
    status: s.status,
    statusNote: s.statusNote,
    patient: {
      id: p.id,
      name: p.nama,
      rm: p.rm,
      sex: p.jk,
      ageYears: p.umur,
      birthDate: p.tanggalLahir,
      allergies: [...p.alergi],
      guarantor: p.kelas ? `${p.penjamin} · ${p.kelas}` : p.penjamin,
    },
    procedure: s.procedure,
    icd9cm: s.icd9cm,
    diagnosis: s.diagnosis,
    operator: s.operator,
    anesthetist: doctorName(DOCTOR_ID.ferry),
    anesthesia: s.anesthesia,
    nurses: { scrub: s.scrub, circulating },
    checklist: [
      phase('sign-in', started ? ALL : NONE, started ? s.startMin - 10 : null, circulating),
      phase('time-out', started ? ALL : NONE, started ? s.startMin + 5 : null, circulating),
      phase('sign-out', done ? ALL : NONE, done ? end - 5 : null, circulating),
    ],
    counts: counts(s.setLabel, done),
    incisionAt: started ? wib(hm(s.startMin + 8)) : null,
    scenario: false,
    scenarioDate: null,
  };
}

const BEDAH = doctorName(DOCTOR_ID.yohanes);
const OBSGIN = doctorName(DOCTOR_ID.hana);

/**
 * Kasus pasien skenario (Ny. Ratna Sari, laparoskopi kolesistektomi 51.23) saat langkah `operasi` Simulasi dimulai:
 * sign in sudah dikonfirmasi, time out sedang berjalan (3 dari 5 butir). Proyeksi skenario (`lib/btn-skenario.ts`)
 * menyesuaikannya dengan kemajuan skenario: sebelum langkah `operasi` kasus masih terjadwal tanpa fase terkonfirmasi,
 * dan jam konfirmasi mengikuti garis waktu Simulasi.
 */
export const KASUS_SKENARIO_OK: OrCase = {
  ...orCase({
    id: OR_CASE_ID.ratna,
    patientId: PATIENT_ID.ratna,
    startMin: 10 * 60 + 30,
    durationMin: 120,
    status: 'berjalan',
    statusNote: 'time out berjalan',
    procedure: 'Kolesistektomi laparoskopik',
    icd9cm: '51.23',
    diagnosis: { icd10: 'K80.2', label: 'Batu kandung empedu tanpa kolesistitis' },
    operator: BEDAH,
    anesthesia: 'Anestesi umum (GA)',
    scrub: NURSE[1],
    setLabel: 'Set laparoskopi',
  }),
  checklist: [
    phase('sign-in', ALL, 10 * 60 + 21, NURSE[0], [
      ...CHECKLIST_LABELS['sign-in'].slice(0, 4),
      'Risiko jalan napas sulit / aspirasi: tidak',
    ]),
    phase('time-out', [true, true, true, false, false], null, NURSE[0], [
      ...CHECKLIST_LABELS['time-out'].slice(0, 2),
      'Antibiotik profilaksis ≤ 60 mnt: sefazolin',
      ...CHECKLIST_LABELS['time-out'].slice(3),
    ]),
    phase('sign-out', NONE, null, NURSE[0]),
  ],
  counts: counts('Set laparoskopi', false),
  incisionAt: null,
  scenario: true,
};

export const JADWAL_OK_STATS = { utilizationPercent: 78, onTimeStartPercent: 67, cancellations: 1 } as const;

/** Jadwal 4 kamar operasi hari demo, 07.00–16.00; "sekarang" = 10.45 (`DEMO_NOW`). */
export const KAMAR_OK: readonly OrRoom[] = [
  {
    id: 'ok1',
    name: 'OK 1',
    kind: 'Bedah umum',
    cases: [
      orCase({
        id: OR_CASE_ID.maria,
        patientId: PATIENT_ID.maria,
        startMin: 9 * 60,
        durationMin: 60,
        status: 'selesai',
        statusNote: 'selesai 09.52',
        procedure: 'Pemasangan kateter vena sentral (akses kemoterapi)',
        icd9cm: '38.93',
        diagnosis: { icd10: 'C18.9', label: 'Neoplasma ganas kolon' },
        operator: BEDAH,
        anesthesia: 'Anestesi lokal + sedasi',
        scrub: NURSE[2],
        setLabel: 'Set akses vaskular',
      }),
      orCase({
        id: OR_CASE_ID.yusuf,
        patientId: PATIENT_ID.yusuf,
        startMin: 13 * 60,
        durationMin: 60,
        status: 'terjadwal',
        statusNote: BEDAH.split(',')[0] ?? BEDAH,
        procedure: 'Pemasangan kateter hemodialisis',
        icd9cm: '38.93',
        diagnosis: { icd10: 'N18.5', label: 'Penyakit ginjal kronik stadium 5' },
        operator: BEDAH,
        anesthesia: 'Anestesi lokal',
        scrub: NURSE[2],
        setLabel: 'Set akses vaskular',
      }),
    ],
  },
  {
    id: 'ok2',
    name: 'OK 2',
    kind: 'Laparoskopi',
    cases: [
      orCase({
        id: OR_CASE_ID.fajar,
        patientId: PATIENT_ID.fajar,
        startMin: 7 * 60 + 30,
        durationMin: 120,
        status: 'selesai',
        statusNote: 'selesai 09.24',
        procedure: 'Kolesistektomi laparoskopik',
        icd9cm: '51.23',
        diagnosis: { icd10: 'K80.2', label: 'Batu kandung empedu tanpa kolesistitis' },
        operator: BEDAH,
        anesthesia: 'Anestesi umum (GA)',
        scrub: NURSE[1],
        setLabel: 'Set laparoskopi',
      }),
      KASUS_SKENARIO_OK,
      orCase({
        id: OR_CASE_ID.sumarni,
        patientId: PATIENT_ID.sumarni,
        startMin: 14 * 60,
        durationMin: 90,
        status: 'terjadwal',
        statusNote: BEDAH.split(',')[0] ?? BEDAH,
        procedure: 'Kolesistektomi laparoskopik',
        icd9cm: '51.23',
        diagnosis: { icd10: 'K80.2', label: 'Batu kandung empedu tanpa kolesistitis' },
        operator: BEDAH,
        anesthesia: 'Anestesi umum (GA)',
        scrub: NURSE[1],
        setLabel: 'Set laparoskopi',
      }),
    ],
  },
  {
    id: 'ok3',
    name: 'OK 3',
    kind: 'Obstetri dan ginekologi',
    cases: [
      orCase({
        id: OR_CASE_ID.wulan,
        patientId: PATIENT_ID.wulan,
        startMin: 7 * 60 + 10,
        durationMin: 70,
        status: 'selesai',
        statusNote: 'selesai 08.18',
        procedure: 'Seksio sesarea elektif',
        icd9cm: '74.1',
        diagnosis: { icd10: 'O82.0', label: 'Persalinan dengan seksio sesarea elektif' },
        operator: OBSGIN,
        anesthesia: 'Anestesi spinal',
        scrub: STAF_LAIN.bidan[0],
        setLabel: 'Set seksio sesarea',
      }),
      orCase({
        id: OR_CASE_ID.anisa,
        patientId: PATIENT_ID.anisa,
        startMin: 11 * 60,
        durationMin: 80,
        status: 'cito',
        statusNote: 'cito · gawat janin · persiapan',
        procedure: 'Seksio sesarea cito',
        icd9cm: '74.1',
        diagnosis: null,
        operator: OBSGIN,
        anesthesia: 'Anestesi spinal',
        scrub: STAF_LAIN.bidan[0],
        setLabel: 'Set seksio sesarea',
      }),
    ],
  },
  {
    id: 'ok4',
    name: 'OK 4',
    kind: 'Ortopedi',
    cases: [
      orCase({
        id: OR_CASE_ID.rizky,
        patientId: PATIENT_ID.rizky,
        startMin: 8 * 60,
        durationMin: 150,
        status: 'selesai',
        statusNote: 'selesai 10.28',
        procedure: 'Reduksi terbuka dan fiksasi interna (ORIF) femur',
        icd9cm: '79.35',
        diagnosis: { icd10: 'S72.3', label: 'Fraktur batang femur' },
        operator: BEDAH,
        anesthesia: 'Anestesi spinal',
        scrub: NURSE[3],
        setLabel: 'Set ortopedi',
      }),
    ],
  },
];
