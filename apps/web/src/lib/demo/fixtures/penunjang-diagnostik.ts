import type { DiagOrder } from '../../penunjang-diagnostik';
import { DOCTOR_ID, PATIENT_ID } from './ids';
import { at, doctorName, supportPatient } from './penunjang';
import { PERSONA } from './staf';

/**
 * S10 · Data dummy penunjang diagnostik lain (ADR-0023), selaras roster hari demo: EKG cito Tn. Ahmad Fauzi (IGD B7,
 * nyeri ulu hati), ekokardiografi Tn. Robert (IGD B8, sesak + kaki bengkak), EGD Tn. Darmawan (dispepsia, Poli PD),
 * fisioterapi pasca ORIF Tn. Rizky (Kenanga K-412), dan EKG Tn. Sutan pagi tadi (sudah ber-TTE).
 */

const base = {
  slot: null,
  performedAt: null,
  performedBy: null,
  findings: {},
  critical: false,
  signed: null,
} as const;

export function demoDiagOrders(): DiagOrder[] {
  return [
    {
      ...base,
      id: 'dg-01',
      kind: 'ekg',
      patient: supportPatient(PATIENT_ID.fauzi),
      location: 'IGD · B7',
      orderedBy: doctorName(DOCTOR_ID.rina),
      orderedAt: at('10.32'),
      priority: 'cito',
      indication: 'Nyeri ulu hati menjalar ke dada sejak pagi, singkirkan sindrom koroner akut',
    },
    {
      ...base,
      id: 'dg-02',
      kind: 'echo',
      patient: supportPatient(PATIENT_ID.robert),
      location: 'IGD · B8',
      orderedBy: doctorName(DOCTOR_ID.bagus),
      orderedAt: at('10.05'),
      priority: 'rutin',
      indication: 'Sesak dan edema tungkai, evaluasi fungsi ventrikel',
    },
    {
      ...base,
      id: 'dg-03',
      kind: 'endoskopi',
      patient: supportPatient(PATIENT_ID.darmawan),
      location: 'Poli Penyakit Dalam · PD-026',
      orderedBy: doctorName(DOCTOR_ID.andini),
      orderedAt: at('10.40'),
      priority: 'rutin',
      indication: 'Dispepsia berulang dengan riwayat konsumsi OAINS',
    },
    {
      ...base,
      id: 'dg-04',
      kind: 'rehab',
      patient: supportPatient(PATIENT_ID.rizky),
      location: 'Bangsal Kenanga · K-412 (kini ruang pulih OK 4)',
      orderedBy: doctorName(DOCTOR_ID.yohanes),
      orderedAt: at('10.30'),
      priority: 'rutin',
      indication: 'Pasca ORIF femur kanan: mobilisasi dini dan latihan jalan dengan alat bantu',
      slot: 'Sel, 6 Okt 2026 · 09.00 · gym rehab',
    },
    {
      ...base,
      id: 'dg-05',
      kind: 'ekg',
      patient: supportPatient(PATIENT_ID.sutan),
      location: 'Paviliun VIP · VIP 2',
      orderedBy: doctorName(DOCTOR_ID.bagus),
      orderedAt: at('06.10'),
      priority: 'rutin',
      indication: 'Angina tidak stabil, evaluasi sebelum angiografi',
      slot: 'Segera (cito, di tempat)',
      performedAt: at('06.25'),
      performedBy: PERSONA.perawat,
      findings: {
        Irama: 'Sinus',
        'Laju jantung': '78 kali/menit',
        Aksis: 'Normal',
        'Segmen ST / gelombang T': 'Inversi T di V4–V6, tanpa elevasi ST',
        Kesimpulan: 'Iskemia anterolateral, tidak ada STEMI',
      },
      signed: { at: at('07.05'), by: doctorName(DOCTOR_ID.bagus) },
    },
  ];
}
