import type { EduRecord, EduTopic } from '../../rme-edukasi';
import { DOCTOR_ID, ENCOUNTER_ID } from './ids';
import { at } from './rawat-inap';
import type { RmeChart } from './rme-pasien';
import { doctorById, PERSONA, STAF, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K11 · Edukasi terintegrasi hari demo. Ny. Endang (pulang hari ini): penyakit, diet, dan obat sudah paham;
 * pencegahan jatuh ke anak perlu diulang pukul 12.00; insulin pen dan perawatan di rumah belum diberikan.
 * Ny. Anisa: edukasi tindakan SC cito belum, sehingga persetujuan tindakan belum siap.
 */

const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);
const E = ENCOUNTER_ID;

/** Materi wajib per kunjungan (dari kebutuhan edukasi asesmen awal keperawatan). */
export const REQUIRED_TOPICS: Readonly<Record<string, readonly EduTopic[]>> = {
  [E.endang]: ['penyakit', 'diet', 'obat', 'insulin', 'jatuh', 'pulang'],
  [E.anisa]: ['tindakan', 'nyeri'],
  [E.sutan]: ['penyakit', 'tindakan', 'obat'],
  [E.yusuf]: ['penyakit', 'diet', 'tindakan'],
};

export function requiredTopics(chart: Pick<RmeChart, 'encounterId' | 'setting'>): readonly EduTopic[] {
  return (
    REQUIRED_TOPICS[chart.encounterId] ??
    (chart.setting === 'rawat-jalan' ? ['penyakit', 'obat'] : ['penyakit', 'obat', 'pulang'])
  );
}

export const EDU_RECORDS: Readonly<Record<string, readonly EduRecord[]>> = {
  [E.endang]: [
    {
      id: `${E.endang}-edukasi-1`,
      topics: ['penyakit'],
      methods: ['lisan'],
      educator: STAF.dpjpPenyakitDalam,
      profession: 'Dokter (DPJP)',
      recipient: 'pasien-keluarga',
      recipientName: 'Ny. Endang Wijaya',
      understanding: 'paham',
      teachBack: 'Paru-paru saya radang, harus antibiotik sampai habis dan gula dijaga.',
      repeatAt: null,
      signature: 'Endang Wijaya',
      at: T('11.30', -4),
    },
    {
      id: `${E.endang}-edukasi-2`,
      topics: ['diet'],
      methods: ['lisan', 'leaflet'],
      educator: 'Nurul Aini, S.Gz',
      profession: 'Dietisien',
      recipient: 'pasien',
      recipientName: 'Ny. Endang Wijaya',
      understanding: 'paham',
      teachBack: 'Makan tiga kali dan dua selingan, kurangi nasi dan manis.',
      repeatAt: null,
      signature: 'Endang Wijaya',
      at: T('10.15', -2),
    },
    {
      id: `${E.endang}-edukasi-3`,
      topics: ['obat'],
      methods: ['lisan', 'leaflet'],
      educator: STAF_LAIN.apoteker[0],
      profession: 'Apoteker',
      recipient: 'pasien',
      recipientName: 'Ny. Endang Wijaya',
      understanding: 'paham',
      teachBack: 'Sefiksim dua kali sehari sampai habis, metformin sesudah makan.',
      repeatAt: null,
      signature: 'Endang Wijaya',
      at: T('09.10', -1),
    },
    {
      id: `${E.endang}-edukasi-4`,
      topics: ['jatuh'],
      methods: ['lisan', 'demonstrasi'],
      educator: PERSONA.perawat,
      profession: 'Perawat',
      recipient: 'keluarga',
      recipientName: 'Sdr. Dimas Wijaya',
      understanding: 'perlu-diulang',
      teachBack: '',
      repeatAt: T('12.00'),
      signature: 'Dimas Wijaya',
      at: T('09.30'),
    },
  ],
  [E.rohana]: [
    {
      id: `${E.rohana}-edukasi-1`,
      topics: ['penyakit', 'obat'],
      methods: ['lisan', 'leaflet'],
      educator: STAF.dpjpPenyakitDalam,
      profession: 'Dokter (DPJP)',
      recipient: 'pasien',
      recipientName: 'Ny. Rohana Siregar',
      understanding: 'paham',
      teachBack: 'Paru sudah membaik; glargine malam naik dua unit, cek gula pagi tiap hari.',
      repeatAt: null,
      signature: 'Rohana Siregar',
      at: T('10.40'),
    },
  ],
  [E.sutan]: [
    {
      id: `${E.sutan}-edukasi-1`,
      topics: ['penyakit', 'tindakan'],
      methods: ['lisan', 'video'],
      educator: doctorById(DOCTOR_ID.melati)?.nama ?? '',
      profession: 'Dokter (DPJP)',
      recipient: 'pasien-keluarga',
      recipientName: 'Tn. Sutan Batubara',
      understanding: 'paham',
      teachBack: 'Pembuluh jantung akan diperiksa lewat kateter dari pergelangan tangan.',
      repeatAt: null,
      signature: 'Sutan Batubara',
      at: T('08.30'),
    },
  ],
};

export const DEFAULT_RECIPIENT: Readonly<Record<string, string>> = {
  [E.endang]: 'Sdr. Dimas Wijaya',
};
