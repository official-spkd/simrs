import type { CarePackage } from '../../rme-paket';
import { ENCOUNTER_ID, PATIENT_ID } from './ids';
import { at } from './rawat-inap';
import { PERSONA, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K15 · Paket layanan khusus hari demo, selaras roster: Tn. Yusuf (HD, kateter HD di OK 1 pukul 13.00 karena AV shunt
 * melemah), Ny. Maria (kemoterapi siklus 4; DL pra-kemo Hb 8,9 g/dL di bawah ambang contoh protokol), Ny. Anisa
 * (paket antenatal sebelum SC cito). Ambang lab adalah contoh protokol RS, bukan pedoman klinis.
 */

const D = (n: number) => shiftDate(DEMO_TODAY, n);
const T = (hm: string, n = 0) => at(D(n), hm);
const done = (by: string, atIso: string) => ({ by, at: atIso });

export function demoCarePackages(): CarePackage[] {
  return [
    {
      id: `${ENCOUNTER_ID.yusuf}-paket-hd`,
      kind: 'hemodialisis',
      title: 'Hemodialisis',
      encounterId: ENCOUNTER_ID.yusuf,
      patientId: PATIENT_ID.yusuf,
      protocol: 'HD rutin 2×/minggu (Sen, Kam), 4 jam; hari ini lewat kateter HD sementara.',
      cycleLabel: 'Sesi HD ke-38',
      sessions: [
        { n: 36, date: D(-7), status: 'selesai', note: 'UF 2,4 L · lewat AV shunt' },
        { n: 37, date: D(-4), status: 'selesai', note: 'UF 2,1 L · thrill shunt melemah' },
        { n: 38, date: D(0), status: 'hari-ini', note: 'Setelah kateter HD terpasang (OK 1 · 13.00)' },
        { n: 39, date: D(3), status: 'terjadwal', note: 'Kamis' },
      ],
      items: [
        {
          id: 'hd-asesmen',
          label: 'Asesmen pra-HD (TTV, BB pra, keluhan)',
          roles: ['perawat'],
          done: done(STAF_LAIN.perawat[3], T('10.00')),
        },
        {
          id: 'hd-lab',
          label: 'Lab pra-HD (ureum, kalium) dibaca DPJP',
          roles: ['dokter'],
          done: done('dr. Sinta Maharani, Sp.PD-KGH', T('10.45')),
        },
        {
          id: 'hd-consent',
          label: 'Persetujuan hemodialisis berlaku',
          roles: [],
          done: done(STAF_LAIN.perawat[3], T('09.00', -60)),
        },
        {
          id: 'hd-akses',
          label: 'Akses vaskular siap: kateter HD terpasang dan foto posisi dibaca',
          roles: ['dokter'],
          done: null,
        },
        {
          id: 'hd-resep',
          label: 'Resep HD DPJP (durasi, target UF, antikoagulan)',
          roles: ['dokter'],
          done: null,
        },
      ],
      labGates: [],
      startLabel: 'Mulai sesi HD',
      finishLabel: 'Selesaikan sesi HD',
    },
    {
      id: `${ENCOUNTER_ID.maria}-paket-kemo`,
      kind: 'kemoterapi',
      title: 'Kemoterapi',
      encounterId: ENCOUNTER_ID.maria,
      patientId: PATIENT_ID.maria,
      protocol: 'Regimen kolorektal siklus 14 hari sesuai protokol komite onkologi RS (contoh).',
      cycleLabel: 'Siklus 4 dari 12',
      sessions: [
        { n: 1, date: D(-42), status: 'selesai', note: 'Tanpa efek samping berat' },
        { n: 2, date: D(-28), status: 'selesai', note: 'Mual derajat 1' },
        { n: 3, date: D(-14), status: 'selesai', note: 'Neuropati ringan' },
        { n: 4, date: D(0), status: 'hari-ini', note: 'Rawat inap setelah kontrol 13.00' },
        { n: 5, date: D(14), status: 'terjadwal', note: '' },
      ],
      items: [
        {
          id: 'kemo-lab',
          label: 'DL pra-kemoterapi tervalidasi',
          roles: [],
          done: done('Sari Rahmawati, A.Md.AK', T('10.20')),
        },
        {
          id: 'kemo-cvc',
          label: 'Kateter vena sentral terpasang',
          roles: [],
          done: done('dr. Ferry Setiawan, Sp.An', T('09.52')),
        },
        {
          id: 'kemo-consent',
          label: 'Persetujuan kemoterapi siklus ini',
          roles: ['dokter'],
          done: done('dr. Rahmat Hidayat, Sp.PD', T('08.30')),
        },
        {
          id: 'kemo-lpt',
          label: 'BB/TB dan luas permukaan tubuh hari ini',
          roles: ['perawat', 'dokter'],
          done: done(PERSONA.perawat, T('08.15')),
        },
        {
          id: 'kemo-verifikasi',
          label: 'Verifikasi ganda dosis (apoteker + perawat)',
          roles: ['perawat'],
          done: null,
        },
      ],
      labGates: [
        { name: 'Hemoglobin', value: 8.9, unit: 'g/dL', min: 10 },
        { name: 'Leukosit', value: 3100, unit: '/µL', min: 3000 },
        { name: 'Trombosit', value: 168000, unit: '/µL', min: 100000 },
      ],
      startLabel: 'Mulai pemberian siklus',
      finishLabel: 'Selesaikan siklus hari ini',
    },
    {
      id: `${ENCOUNTER_ID.anisa}-paket-anc`,
      kind: 'anc',
      title: 'Antenatal (ANC)',
      encounterId: ENCOUNTER_ID.anisa,
      patientId: PATIENT_ID.anisa,
      protocol: 'Kunjungan antenatal minimal 6 kali; skrining dan rencana persalinan sebelum persalinan.',
      cycleLabel: 'G1P0A0 · 38 minggu',
      sessions: [
        { n: 1, date: '2026-03-10', status: 'selesai', note: 'K1 · trimester 1' },
        { n: 2, date: '2026-04-21', status: 'selesai', note: 'K2 · USG trimester 1' },
        { n: 3, date: '2026-06-09', status: 'selesai', note: 'K3 · trimester 2' },
        { n: 4, date: '2026-08-04', status: 'selesai', note: 'K4 · trimester 3' },
        { n: 5, date: '2026-09-08', status: 'selesai', note: 'K5 · USG trimester 3' },
        { n: 6, date: D(0), status: 'hari-ini', note: 'K6 · gawat janin → SC cito 11.00' },
      ],
      items: [
        {
          id: 'anc-lab',
          label: 'Lab Hb dan golongan darah',
          roles: [],
          done: done(PERSONA.bidan, T('09.00', -27)),
        },
        {
          id: 'anc-skrining',
          label: 'Skrining HIV, sifilis, hepatitis B',
          roles: [],
          done: done(PERSONA.bidan, T('09.10', -27)),
        },
        {
          id: 'anc-imunisasi',
          label: 'Status imunisasi Td tercatat',
          roles: ['bidan'],
          done: done(PERSONA.bidan, T('09.20', -27)),
        },
        {
          id: 'anc-rencana',
          label: 'Rencana persalinan dan rujukan',
          roles: ['bidan', 'dokter'],
          done: null,
        },
      ],
      labGates: [],
      startLabel: 'Tutup paket ANC (lanjut persalinan)',
      finishLabel: 'Paket ANC ditutup',
    },
  ];
}
