import type { InpatientDetail } from '@simrs/shared';
import { DOCTOR_ID, ENCOUNTER_ID, PATIENT_ID } from './ids';
import { type DemoPatient, patientById } from './pasien';
import { demoInpatients } from './rawat-inap';
import { BANGSAL } from './rs';
import { doctorById } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * Fase 3 · Rekam medis elektronik per pasien (K01, K06–K08, K10–K15) mode presentasi (ADR-0023): daftar kunjungan
 * yang punya "bagan" RME di layar FE2 (Ringkasan, CPPT, Asesmen, Diagnosis, Edukasi, Askep, Kelengkapan). Pasien
 * rawat inap diambil dari fixture Rawat inap (`demoInpatients`), sisanya mengikuti roster hari demo (`pasien.ts`).
 * Pasien skenario Simulasi (Tn. Suryo, Tn. Hartono, Ny. Ratna) tidak masuk: keadaannya diatur mesin skenario.
 */

export type RmeSetting = 'rawat-inap' | 'rawat-jalan' | 'kamar-bersalin';

export const RME_SETTING_LABEL: Record<RmeSetting, string> = {
  'rawat-inap': 'Rawat inap',
  'rawat-jalan': 'Rawat jalan',
  'kamar-bersalin': 'Kamar bersalin',
};

export interface RmeChart {
  patientId: string;
  encounterId: string;
  setting: RmeSetting;
  /** Ruang + bed / poli, mis. "Bangsal Melati M-203". */
  lokasi: string;
  dpjp: string;
  /** Hari rawat ke-n (rawat inap), null untuk rawat jalan. */
  day: number | null;
  /** Tanggal mulai kunjungan `YYYY-MM-DD`. */
  startedOn: string;
  /** Rekam rawat inap lengkap (CPPT, eMAR, EWS, hasil, askep) bila pasien dirawat. */
  inpatient: InpatientDetail | null;
}

function doctorName(id: string): string {
  const d = doctorById(id);
  if (!d) throw new Error(`Dokter ${id} tidak ada di fixture`);
  return d.nama;
}

/** Kunjungan non-rawat-inap-fixture (roster hari demo). */
const OTHER_CHARTS: ReadonlyArray<Omit<RmeChart, 'inpatient'>> = [
  {
    patientId: PATIENT_ID.sutan,
    encounterId: ENCOUNTER_ID.sutan,
    setting: 'rawat-inap',
    lokasi: 'Paviliun VIP 2',
    dpjp: doctorName(DOCTOR_ID.melati),
    day: 2,
    startedOn: shiftDate(DEMO_TODAY, -1),
  },
  {
    patientId: PATIENT_ID.rohana,
    encounterId: ENCOUNTER_ID.rohana,
    setting: 'rawat-jalan',
    lokasi: 'Poli Penyakit Dalam · PD-025',
    dpjp: doctorName(DOCTOR_ID.andini),
    day: null,
    startedOn: DEMO_TODAY,
  },
  {
    patientId: PATIENT_ID.darmawan,
    encounterId: ENCOUNTER_ID.darmawan,
    setting: 'rawat-jalan',
    lokasi: 'Poli Penyakit Dalam · PD-026',
    dpjp: doctorName(DOCTOR_ID.andini),
    day: null,
    startedOn: DEMO_TODAY,
  },
  {
    patientId: PATIENT_ID.dewi,
    encounterId: ENCOUNTER_ID.dewi,
    setting: 'rawat-jalan',
    lokasi: 'Poli Penyakit Dalam · PD-023',
    dpjp: doctorName(DOCTOR_ID.andini),
    day: null,
    startedOn: DEMO_TODAY,
  },
  {
    patientId: PATIENT_ID.maria,
    encounterId: ENCOUNTER_ID.maria,
    setting: 'rawat-jalan',
    lokasi: 'Poli Penyakit Dalam · pra-kemoterapi',
    dpjp: doctorName(DOCTOR_ID.rahmat),
    day: null,
    startedOn: DEMO_TODAY,
  },
  {
    patientId: PATIENT_ID.anisa,
    encounterId: ENCOUNTER_ID.anisa,
    setting: 'kamar-bersalin',
    lokasi: 'Kamar bersalin',
    dpjp: doctorName(DOCTOR_ID.hana),
    day: null,
    startedOn: DEMO_TODAY,
  },
];

/** Semua bagan RME (rawat inap dulu, urut bangsal; lalu rawat jalan dan kamar bersalin). */
export function demoRmeCharts(): RmeChart[] {
  const inpatients: RmeChart[] = demoInpatients().map((d) => {
    const s = d.summary;
    const ward = BANGSAL.find((w) => w.code === s.wardCode);
    return {
      patientId: s.patientId,
      encounterId: s.encounterId,
      setting: 'rawat-inap',
      lokasi: `${ward?.name ?? s.wardCode} ${s.bed}`,
      dpjp: s.dpjp,
      day: s.day,
      startedOn: s.admittedOn,
      inpatient: d,
    };
  });
  return [...inpatients, ...OTHER_CHARTS.map((c) => ({ ...c, inpatient: null }))];
}

/** Pasien bawaan bagan RME: Ny. Endang (Melati M-203, pulang hari ini; mockup Ranap dan Resume). */
export const DEFAULT_RME_ENCOUNTER = ENCOUNTER_ID.endang;

export function rmeChartByEncounter(encounterId: string | null | undefined): RmeChart | undefined {
  return demoRmeCharts().find((c) => c.encounterId === encounterId);
}

export function chartPatient(chart: Pick<RmeChart, 'patientId'>): DemoPatient {
  const p = patientById(chart.patientId);
  if (!p) throw new Error(`Pasien ${chart.patientId} tidak ada di fixture`);
  return p;
}
