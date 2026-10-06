import type { FhirResource, Visit } from '../../integrasi-satusehat';
import { PATIENT_ID } from './ids';
import { patientById } from './pasien';
import { DEMO_TODAY } from './waktu';

/**
 * I02 · Data dummy pengiriman SATUSEHAT per kunjungan (ADR-0023), selaras dead-letter queue hub Integrasi:
 * dlq-0099 (Observation HbA1c kode lokal, Tn. Lukman), dlq-0103 (Encounter tanpa IHS, Ny. Fransiska), dlq-0087
 * (MedicationRequest racikan tanpa KFA, Ny. Endang). Kode hanya dari contoh seed (ICD-10, ICD-9-CM, LOINC, KFA).
 * ID resource dan IHS fiktif; payload hanya berisi rujukan teknis.
 */

const at = (hhmm: string) => `${DEMO_TODAY}T${hhmm.replace('.', ':')}:00+07:00`;

function patient(id: string, ihs: string | null, ihsFound: string) {
  const p = patientById(id);
  if (!p) throw new Error(`Pasien demo ${id} tidak ada`);
  return { name: p.nama, rm: p.rm, nikMasked: p.nikMasked, ihs, ihsFound };
}

type R = Omit<FhirResource, 'resourceId' | 'error' | 'holdReason' | 'payload'> &
  Partial<Pick<FhirResource, 'resourceId' | 'error' | 'holdReason' | 'payload'>>;

const res = (r: R): FhirResource => ({
  resourceId: r.sent ? `${r.type.split(' ')[0]}/${r.id.replace(/\D/g, '').padStart(8, '0')}c41a` : null,
  error: null,
  holdReason: null,
  payload: {},
  ...r,
});

export function demoSatusehatVisits(): Visit[] {
  return [
    {
      id: 'ss-v1',
      encounterNo: 'ENC-2610-0812',
      kind: 'Rawat jalan',
      unit: 'Poli Penyakit Dalam · PD-020',
      patient: patient(PATIENT_ID.lukman, 'P02478375538', 'P02478375538'),
      resources: [
        res({
          id: 'ss-101',
          type: 'Encounter',
          label: 'Kunjungan rawat jalan dimulai',
          code: null,
          at: at('08.40'),
          sent: true,
        }),
        res({
          id: 'ss-102',
          type: 'Condition',
          label: 'Diabetes melitus tipe 2',
          code: 'ICD-10 E11.9',
          at: at('08.52'),
          sent: true,
        }),
        res({
          id: 'ss-103',
          type: 'Observation',
          label: 'Glukosa sewaktu (POCT) 36 mg/dL',
          code: 'LOINC 2345-7',
          at: at('08.53'),
          sent: true,
        }),
        res({
          id: 'ss-104',
          type: 'Observation',
          label: 'HbA1c 8,1 %',
          code: 'lokal-HbA1c',
          at: at('10.18'),
          sent: false,
          error: {
            httpStatus: 400,
            code: 'code-invalid',
            message: 'Kode lab lokal belum dipetakan ke LOINC',
            dlqId: 'dlq-0099',
            fix: 'loinc',
            fixLabel: 'Petakan kode lokal-HbA1c → LOINC 4548-4 (HbA1c)',
            blockedReason: null,
          },
          payload: {
            resourceType: 'Observation',
            status: 'final',
            code: { coding: [{ system: 'http://loinc.org', code: 'lokal-HbA1c' }] },
            subject: { reference: 'Patient/P02478375538' },
            encounter: { reference: 'Encounter/00000101c41a' },
            identifier: [{ system: 'obs', value: 'OBS-2610-5521' }],
          },
        }),
        res({
          id: 'ss-105',
          type: 'MedicationRequest',
          label: 'Atorvastatin 40 mg tablet 1 × 1',
          code: 'KFA 93000914',
          at: at('09.20'),
          sent: true,
        }),
        res({
          id: 'ss-106',
          type: 'Encounter selesai',
          label: 'Kunjungan selesai + diagnosis',
          code: 'ICD-10 E11.9',
          at: null,
          sent: false,
        }),
      ],
    },
    {
      id: 'ss-v2',
      encounterNo: 'ENC-2610-0794',
      kind: 'Rawat jalan',
      unit: 'Poli Penyakit Dalam · PD-021',
      patient: patient(PATIENT_ID.fransiska, null, 'P03319027764'),
      resources: [
        res({
          id: 'ss-201',
          type: 'Encounter',
          label: 'Kunjungan rawat jalan dimulai',
          code: null,
          at: at('10.22'),
          sent: false,
          error: {
            httpStatus: 422,
            code: 'required',
            message: 'IHS number pasien belum ada (identitas belum tervalidasi)',
            dlqId: 'dlq-0103',
            fix: 'ihs',
            fixLabel: 'Cari IHS pasien lewat NIK tervalidasi Dukcapil',
            blockedReason: null,
          },
          payload: {
            resourceType: 'Encounter',
            status: 'arrived',
            class: { code: 'AMB' },
            subject: { reference: null },
            identifier: [{ system: 'kunjungan', value: 'ENC-2610-0794' }],
            nik: '9999000000000000',
            name: 'tersamar',
          },
        }),
        res({
          id: 'ss-202',
          type: 'Condition',
          label: 'Gout',
          code: 'ICD-10 M10.9',
          at: at('10.24'),
          sent: false,
        }),
        res({
          id: 'ss-203',
          type: 'Observation',
          label: 'Kreatinin 0,9 mg/dL',
          code: 'LOINC 2160-0',
          at: at('10.25'),
          sent: false,
        }),
        res({
          id: 'ss-204',
          type: 'Encounter selesai',
          label: 'Kunjungan selesai + diagnosis',
          code: 'ICD-10 M10.9',
          at: null,
          sent: false,
        }),
      ],
    },
    {
      id: 'ss-v3',
      encounterNo: 'ENC-2610-0587',
      kind: 'Rawat inap',
      unit: 'Bangsal Melati · M-203',
      patient: patient(PATIENT_ID.endang, 'P01938442210', 'P01938442210'),
      resources: [
        res({
          id: 'ss-301',
          type: 'Encounter',
          label: 'Rawat inap dimulai',
          code: null,
          at: at('14.10').replace(DEMO_TODAY, '2026-10-01'),
          sent: true,
        }),
        res({
          id: 'ss-302',
          type: 'Condition',
          label: 'Pneumonia',
          code: 'ICD-10 J18.9',
          at: at('09.00'),
          sent: true,
        }),
        res({
          id: 'ss-303',
          type: 'Condition',
          label: 'Diabetes melitus tipe 2',
          code: 'ICD-10 E11.9',
          at: at('09.00'),
          sent: true,
        }),
        res({
          id: 'ss-304',
          type: 'Observation',
          label: 'Kreatinin 1,3 mg/dL',
          code: 'LOINC 2160-0',
          at: at('10.12'),
          sent: true,
        }),
        res({
          id: 'ss-305',
          type: 'MedicationRequest',
          label: 'Racikan puyer batuk (resep pulang)',
          code: null,
          at: at('09.57'),
          sent: false,
          error: {
            httpStatus: 400,
            code: 'invariant',
            message: 'Racikan wajib Medication dengan daftar bahan (KFA)',
            dlqId: 'dlq-0087',
            fix: 'kfa',
            fixLabel: 'Petakan setiap bahan racikan ke KFA',
            blockedReason:
              'Menunggu farmasi memetakan bahan racikan ke KFA di formularium; belum bisa dikirim ulang dari sini.',
          },
          payload: {
            resourceType: 'MedicationRequest',
            status: 'active',
            intent: 'order',
            medicationReference: { reference: 'Medication/racikan-RSP-2610-0412' },
            subject: { reference: 'Patient/P01938442210' },
          },
        }),
        res({
          id: 'ss-306',
          type: 'Composition',
          label: 'Resume medis pulang',
          code: null,
          at: null,
          sent: false,
          holdReason: 'menunggu TTE resume medis oleh DPJP',
        }),
        res({
          id: 'ss-307',
          type: 'Encounter selesai',
          label: 'Rawat inap selesai + diagnosis',
          code: 'ICD-10 J18.9',
          at: null,
          sent: false,
        }),
      ],
    },
    {
      id: 'ss-v4',
      encounterNo: 'ENC-2610-0561',
      kind: 'Rawat inap',
      unit: 'ICU/ICCU · ICU 2',
      patient: patient(PATIENT_ID.hendro, 'P04410287713', 'P04410287713'),
      resources: [
        res({
          id: 'ss-401',
          type: 'Encounter',
          label: 'Rawat inap ICU dimulai',
          code: null,
          at: at('22.40').replace(DEMO_TODAY, '2026-10-03'),
          sent: true,
        }),
        res({
          id: 'ss-402',
          type: 'Condition',
          label: 'Gagal napas akut',
          code: 'ICD-10 J96.0',
          at: at('07.10'),
          sent: true,
        }),
        res({
          id: 'ss-403',
          type: 'Procedure',
          label: 'Ventilasi mekanik < 96 jam',
          code: 'ICD-9-CM 96.71',
          at: at('07.15'),
          sent: true,
        }),
        res({
          id: 'ss-404',
          type: 'Observation',
          label: 'Kalium 3,9 mmol/L',
          code: 'LOINC 2823-3',
          at: at('10.12'),
          sent: true,
        }),
        res({
          id: 'ss-405',
          type: 'Observation',
          label: 'Natrium 139 mmol/L',
          code: 'LOINC 2951-2',
          at: at('10.12'),
          sent: true,
        }),
      ],
    },
  ];
}
