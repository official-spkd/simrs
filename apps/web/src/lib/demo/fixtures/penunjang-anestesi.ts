import { type AnesthesiaRecord, EMPTY_PRE } from '../../penunjang-anestesi';
import { DOCTOR_ID } from './ids';
import { at, doctorName } from './penunjang';

/**
 * S06 · Catatan anestesi awal per kasus kamar operasi (id kasus `KAMAR_OK`, ADR-0023): kasus selesai sudah punya
 * asesmen + monitoring; Ny. Ratna (skenario, OK 2) sudah dinilai kemarin; SC cito Ny. Anisa dan kolesistektomi
 * Ny. Sumarni belum dinilai. Dokter anestesi = dr. Ferry Setiawan, Sp.An (daftar dokter fiktif).
 */

export const ANESTESIOLOG = doctorName(DOCTOR_ID.ferry);

const signedPre = (asa: AnesthesiaRecord['pre']['asa'], fasting: string, plan: string, signedAt: string) => ({
  asa,
  emergency: false,
  fastingSince: fasting,
  airway: 'Mallampati II',
  plan,
  consent: true,
  signed: { at: signedAt, by: ANESTESIOLOG },
});

const done = (
  pre: AnesthesiaRecord['pre'],
  induction: string,
  rows: Array<[string, number, number, number, number, number]>,
): AnesthesiaRecord => ({
  pre,
  inductionAt: at(induction),
  vitals: rows.map(([t, systolic, diastolic, pulse, spo2, etco2]) => ({
    at: at(t),
    systolic,
    diastolic,
    pulse,
    spo2,
    etco2,
  })),
});

export function demoAnesthesia(): Record<string, AnesthesiaRecord> {
  return {
    'ok1-2': done(signedPre('III', '00.00', 'Anestesi lokal + sedasi ringan', at('07.40')), '09.05', [
      ['09.05', 128, 76, 88, 98, 36],
      ['09.20', 122, 74, 84, 99, 35],
    ]),
    'ok1-3': {
      pre: signedPre('III', '05.00', 'Anestesi lokal, monitoring standar', at('08.10')),
      inductionAt: null,
      vitals: [],
    },
    'ok2-1': done(signedPre('II', '22.00', 'Anestesi umum, intubasi ETT', at('16.00', -1)), '07.32', [
      ['07.35', 132, 80, 86, 99, 35],
      ['08.00', 118, 70, 78, 99, 36],
      ['08.30', 116, 72, 76, 100, 35],
    ]),
    'ok2-2': {
      pre: signedPre('II', '22.00', 'Anestesi umum, intubasi ETT, PONV profilaksis', at('15.30', -1)),
      inductionAt: null,
      vitals: [],
    },
    'ok2-3': { pre: { ...EMPTY_PRE }, inductionAt: null, vitals: [] },
    'ok3-0': done(signedPre('II', '22.00', 'Anestesi spinal', at('17.00', -1)), '07.10', [
      ['07.12', 118, 72, 96, 99, 34],
      ['07.27', 104, 64, 102, 98, 34],
    ]),
    'ok3-1': { pre: { ...EMPTY_PRE, emergency: true }, inductionAt: null, vitals: [] },
    'ok4-1': done(signedPre('II', '23.00', 'Anestesi spinal', at('16.30', -1)), '08.45', [
      ['08.48', 126, 78, 82, 99, 35],
      ['09.15', 120, 74, 78, 99, 35],
    ]),
  };
}
