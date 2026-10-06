import type { BloodRequest, BloodUnit } from '../../penunjang-bank-darah';
import { DOCTOR_ID, PATIENT_ID } from './ids';
import { at, doctorName, supportPatient } from './penunjang';
import { PERSONA, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * S08 · Data dummy bank darah RS (ADR-0023), selaras roster hari demo: Ny. Anisa (SC cito 11.00, golongan O+ dari
 * LIS L2610050163) menunggu crossmatch kantong kedua; Ny. Sumarni (kolesistektomi 14.00) dua kantong dicadangkan;
 * Ny. Wulan (pasca SC, Mawar W-322) sedang ditransfusi; Ny. Maria (pra-kemoterapi) permintaan baru. Nomor kantong
 * fiktif; satu kantong O+ kedaluwarsa kemarin (tidak boleh dipilih).
 */

const ed = (days: number) => shiftDate(DEMO_TODAY, days);
const ANALIS_BD = STAF_LAIN.analis[0] ?? PERSONA.analisLab;

export function demoBloodUnits(): BloodUnit[] {
  const u = (
    id: string,
    bagNo: string,
    component: BloodUnit['component'],
    abo: BloodUnit['abo'],
    rh: BloodUnit['rh'],
    expiryDays: number,
    status: BloodUnit['status'] = 'tersedia',
    requestId: string | null = null,
  ): BloodUnit => ({
    id,
    bagNo,
    component,
    abo,
    rh,
    volumeMl: component === 'PRC' ? 250 : component === 'FFP' ? 200 : 50,
    expiry: ed(expiryDays),
    status,
    requestId,
  });
  return [
    u('bu-o1', 'KD-261001-031', 'PRC', 'O', '+', 31, 'dicadangkan', 'bd-01'),
    u('bu-o2', 'KD-261001-044', 'PRC', 'O', '+', 31),
    u('bu-o3', 'KD-260830-007', 'PRC', 'O', '+', -1),
    u('bu-o4', 'KD-261002-012', 'PRC', 'O', '+', 32),
    u('bu-on1', 'KD-260930-003', 'PRC', 'O', '-', 30),
    u('bu-a1', 'KD-261001-020', 'PRC', 'A', '+', 31, 'dicadangkan', 'bd-03'),
    u('bu-a2', 'KD-261001-021', 'PRC', 'A', '+', 31, 'dicadangkan', 'bd-03'),
    u('bu-a3', 'KD-261002-005', 'PRC', 'A', '+', 32),
    u('bu-b0', 'KD-260930-041', 'PRC', 'B', '+', 30, 'dikeluarkan', 'bd-04'),
    u('bu-b1', 'KD-261002-018', 'PRC', 'B', '+', 32),
    u('bu-ab1', 'KD-261003-002', 'PRC', 'AB', '+', 33),
    u('bu-ff1', 'KD-260915-002', 'FFP', 'AB', '+', 340),
    u('bu-ff2', 'KD-260920-011', 'FFP', 'O', '+', 345),
    u('bu-tc1', 'KD-261004-009', 'TC', 'O', '+', 3),
  ];
}

export function demoBloodRequests(): BloodRequest[] {
  return [
    {
      id: 'bd-01',
      patient: supportPatient(PATIENT_ID.anisa),
      location: 'Kamar bersalin (VK) · SC cito OK 3 pukul 11.00',
      dpjp: doctorName(DOCTOR_ID.hana),
      component: 'PRC',
      units: 2,
      indication: 'Persiapan SC cito (gawat janin), cadangan perdarahan',
      urgency: 'cito',
      requestedAt: at('10.10'),
      receivedAt: at('10.14'),
      abo: 'O',
      rh: '+',
      groupSource: 'LIS L2610050163 · forward + reverse typing 10.06',
      crossmatches: [{ unitId: 'bu-o1', result: 'kompatibel', at: at('10.32'), by: ANALIS_BD }],
      issued: [],
      transfusion: null,
    },
    {
      id: 'bd-02',
      patient: supportPatient(PATIENT_ID.maria),
      location: 'Poli Penyakit Dalam (pra-kemoterapi) · kini CT 1',
      dpjp: doctorName(DOCTOR_ID.rahmat),
      component: 'PRC',
      units: 1,
      indication: 'Anemia pra-kemoterapi (Hb 8,9 g/dL), transfusi saat rawat inap sore ini',
      urgency: 'rutin',
      requestedAt: at('09.30'),
      receivedAt: null,
      abo: null,
      rh: null,
      groupSource: null,
      crossmatches: [],
      issued: [],
      transfusion: null,
    },
    {
      id: 'bd-03',
      patient: supportPatient(PATIENT_ID.sumarni),
      location: 'IGD B5 · kolesistektomi pukul 14.00',
      dpjp: doctorName(DOCTOR_ID.yohanes),
      component: 'PRC',
      units: 2,
      indication: 'Cadangan operasi (type and crossmatch)',
      urgency: 'rutin',
      requestedAt: at('08.20'),
      receivedAt: at('08.41'),
      abo: 'A',
      rh: '+',
      groupSource: 'Diperiksa bank darah 08.50 (forward + reverse)',
      crossmatches: [
        { unitId: 'bu-a1', result: 'kompatibel', at: at('09.25'), by: ANALIS_BD },
        { unitId: 'bu-a2', result: 'kompatibel', at: at('09.27'), by: ANALIS_BD },
      ],
      issued: [],
      transfusion: null,
    },
    {
      id: 'bd-04',
      patient: supportPatient(PATIENT_ID.wulan),
      location: 'Bangsal Mawar · W-322',
      dpjp: doctorName(DOCTOR_ID.hana),
      component: 'PRC',
      units: 1,
      indication: 'Anemia pasca SC (Hb 7,8 g/dL), simtomatik',
      urgency: 'rutin',
      requestedAt: at('08.05'),
      receivedAt: at('08.15'),
      abo: 'B',
      rh: '+',
      groupSource: 'Diperiksa bank darah 08.22 (forward + reverse)',
      crossmatches: [{ unitId: 'bu-b0', result: 'kompatibel', at: at('09.40'), by: ANALIS_BD }],
      issued: [{ unitId: 'bu-b0', at: at('10.12'), checkers: [ANALIS_BD, 'Bd. Wina Kartikasari, S.Tr.Keb'] }],
      transfusion: {
        unitId: 'bu-b0',
        startedAt: at('10.25'),
        verifiedBy: 'Bd. Wina Kartikasari, S.Tr.Keb + Ns. Rosa Elvira, S.Kep',
        manualReason: null,
        vitals: [
          { at: at('10.22'), label: 'Sebelum mulai', tempC: 36.8, systolic: 112, diastolic: 70, pulse: 92 },
          { at: at('10.40'), label: '15 menit', tempC: 36.9, systolic: 114, diastolic: 72, pulse: 90 },
        ],
        reaction: null,
        finishedAt: null,
      },
    },
  ];
}
