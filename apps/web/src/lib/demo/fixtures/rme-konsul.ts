import type { CareTeamMember, ConsultRequest } from '../../rme-konsul';
import { DOCTOR_ID, ENCOUNTER_ID, PATIENT_ID } from './ids';
import { at } from './rawat-inap';
import { ENCOUNTER_START_HM } from './rme-asesmen';
import type { RmeChart } from './rme-pasien';
import { DOKTER, doctorById } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K10 · Konsultasi dan tim perawatan hari demo. Selaras roster: konsul PD cito Tn. Sutan (eGFR 42) sebelum angiografi
 * 13.00 belum dijawab; konsul bedah Tn. Yusuf untuk kateter HD sudah dijawab; Ny. Endang pernah dikonsulkan ke Paru.
 */

const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);
const doc = (id: string) => doctorById(id)?.nama ?? '';

export const CONSULTS: readonly ConsultRequest[] = [
  {
    id: `${ENCOUNTER_ID.sutan}-konsul-1`,
    encounterId: ENCOUNTER_ID.sutan,
    patientId: PATIENT_ID.sutan,
    from: doc(DOCTOR_ID.melati),
    toSpecialty: 'Penyakit Dalam',
    to: doc(DOCTOR_ID.andini),
    kind: 'sekali',
    urgency: 'cito',
    question:
      'Rencana angiografi koroner pukul 13.00. eGFR 42 mL/menit/1,73 m², kreatinin 1,6 mg/dL. Mohon penilaian risiko nefropati kontras dan tata laksana fungsi ginjal pra dan pasca tindakan.',
    sentAt: T('09.30'),
    answer: null,
  },
  {
    id: `${ENCOUNTER_ID.yusuf}-konsul-1`,
    encounterId: ENCOUNTER_ID.yusuf,
    patientId: PATIENT_ID.yusuf,
    from: doc(DOCTOR_ID.sinta),
    toSpecialty: 'Bedah',
    to: doc(DOCTOR_ID.yohanes),
    kind: 'sekali',
    urgency: 'cito',
    question: 'Thrill AV shunt lengan kiri melemah, curiga trombosis. Mohon pemasangan akses HD sementara.',
    sentAt: T('08.40'),
    answer: {
      findings: 'Thrill dan bruit AV shunt kiri sangat lemah.',
      conclusion: 'Curiga trombosis AV shunt lengan kiri.',
      recommendation:
        'Kateter HD sementara (vena jugularis kanan) di OK 1 pukul 13.00; evaluasi revisi shunt elektif.',
      followUp: 'selesai',
      by: doc(DOCTOR_ID.yohanes),
      at: T('09.05'),
    },
  },
  {
    id: `${ENCOUNTER_ID.endang}-konsul-1`,
    encounterId: ENCOUNTER_ID.endang,
    patientId: PATIENT_ID.endang,
    from: doc(DOCTOR_ID.andini),
    toSpecialty: 'Paru',
    to: doc(DOCTOR_ID.kartika),
    kind: 'sekali',
    urgency: 'biasa',
    question: 'Pneumonia komunitas H3 dengan DM. Mohon evaluasi respons antibiotik dan rencana de-eskalasi.',
    sentAt: T('10.00', -1),
    answer: {
      findings: 'Ronki basah kanan berkurang, foto toraks perbaikan infiltrat.',
      conclusion: 'Pneumonia komunitas, respons baik.',
      recommendation: 'Seftriakson sampai H5, lanjut sefiksim oral 5 hari; kontrol Poli Paru 2 minggu.',
      followUp: 'selesai',
      by: doc(DOCTOR_ID.kartika),
      at: T('14.20', -1),
    },
  },
];

/** Tim perawatan tambahan di luar DPJP utama (rawat bersama berjalan). */
const EXTRA_TEAM: Readonly<Record<string, ReadonlyArray<Omit<CareTeamMember, 'id'>>>> = {
  [ENCOUNTER_ID.hendro]: [
    {
      name: doc(DOCTOR_ID.ferry),
      role: 'rawat-bersama',
      since: T('08.00', -2),
      until: null,
      note: 'Intensivis ICU',
    },
  ],
};

export function careTeam(chart: RmeChart): CareTeamMember[] {
  const start = at(chart.startedOn, ENCOUNTER_START_HM[chart.encounterId] ?? '09.00');
  return [
    {
      id: `${chart.encounterId}-tim-1`,
      name: chart.dpjp,
      role: 'dpjp-utama',
      since: start,
      until: null,
      note: null,
    },
    ...(EXTRA_TEAM[chart.encounterId] ?? []).map((m, i) => ({
      ...m,
      id: `${chart.encounterId}-tim-${i + 2}`,
    })),
  ];
}

/** Dokter konsultan yang bisa dituju (nama · spesialisasi). */
export const CONSULTANTS: ReadonlyArray<{ name: string; specialty: string }> = DOKTER.filter(
  (d) => d.poli !== null || d.spesialisasi === 'Anestesi',
).map((d) => ({ name: d.nama, specialty: d.spesialisasi }));
