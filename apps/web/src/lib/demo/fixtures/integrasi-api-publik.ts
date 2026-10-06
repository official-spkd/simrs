import type { AccessLog, ApiClient } from '../../integrasi-api-publik';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * I12 · Data dummy klien API publik/FHIR (ADR-0023). Nama mitra generik fiktif; akhiran kunci bukan rahasia. Satu
 * kunci perlu dirotasi (≤ 30 hari), satu klien ditangguhkan. Log akses memperlihatkan 403 cakupan dan audit per
 * pasien (identifier hanya RM + IHS).
 */

const at = (hhmm: string, day = 0) => `${shiftDate(DEMO_TODAY, day)}T${hhmm.replace('.', ':')}:00+07:00`;

export function demoApiClients(): ApiClient[] {
  return [
    {
      id: 'cl-asuransi-a',
      name: 'Asuransi mitra A',
      purpose: 'Verifikasi klaim rawat jalan peserta asuransi swasta',
      scopes: ['Patient.read', 'Encounter.read', 'Condition.read'],
      status: 'aktif',
      keySuffix: '7f3a',
      keyCreated: shiftDate(DEMO_TODAY, -340),
      keyExpires: shiftDate(DEMO_TODAY, 25),
      lastUsed: at('10.31'),
      basis: 'Perjanjian kerja sama No. PKS-RS/2025/014 + persetujuan peserta saat pendaftaran',
      suspendedReason: null,
    },
    {
      id: 'cl-app-sehat',
      name: 'Aplikasi kesehatan B',
      purpose: 'Riwayat kunjungan dan hasil lab untuk pasien yang menautkan akunnya',
      scopes: ['Patient.read', 'Encounter.read', 'Observation.read'],
      status: 'aktif',
      keySuffix: 'c2d9',
      keyCreated: shiftDate(DEMO_TODAY, -60),
      keyExpires: shiftDate(DEMO_TODAY, 305),
      lastUsed: at('10.12'),
      basis: 'Persetujuan elektronik pasien per tautan akun (dicatat di P04)',
      suspendedReason: null,
    },
    {
      id: 'cl-riset-c',
      name: 'Mitra riset C',
      purpose: 'Uji coba integrasi data rawat jalan',
      scopes: ['Encounter.read'],
      status: 'ditangguhkan',
      keySuffix: '04be',
      keyCreated: shiftDate(DEMO_TODAY, -120),
      keyExpires: shiftDate(DEMO_TODAY, 245),
      lastUsed: at('16.02', -3),
      basis: null,
      suspendedReason: 'Masa uji coba berakhir 2 Okt; menunggu perjanjian baru',
    },
  ];
}

export function demoAccessLog(): AccessLog[] {
  return [
    {
      at: at('10.31'),
      clientId: 'cl-asuransi-a',
      request: 'GET /fhir/r4/Encounter?patient=…',
      status: 200,
      note: '3 entri · audit baca 1 pasien',
    },
    {
      at: at('10.29'),
      clientId: 'cl-asuransi-a',
      request: 'GET /fhir/r4/Observation?patient=…',
      status: 403,
      note: 'cakupan Observation.read tidak diberikan',
    },
    {
      at: at('10.12'),
      clientId: 'cl-app-sehat',
      request: 'GET /fhir/r4/Patient/…',
      status: 200,
      note: 'identifier RM + IHS (tanpa NIK) · audit baca',
    },
    {
      at: at('09.58'),
      clientId: 'cl-app-sehat',
      request: 'GET /fhir/r4/metadata',
      status: 200,
      note: 'CapabilityStatement',
    },
    {
      at: at('16.02', -3),
      clientId: 'cl-riset-c',
      request: 'GET /fhir/r4/Encounter?patient=…',
      status: 200,
      note: 'sebelum ditangguhkan',
    },
  ];
}
