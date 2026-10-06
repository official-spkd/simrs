import { MORSE_FALL_SCALE } from '@simrs/shared';
import type { AssessmentForm, AssessmentResponse, AssessmentSetting } from '../../rme-asesmen';
import { DOCTOR_ID, ENCOUNTER_ID } from './ids';
import { at } from './rawat-inap';
import { doctorById, PERSONA, STAF, STAF_LAIN } from './staf';
import { DEMO_TODAY, shiftDate } from './waktu';

/**
 * K06 · Pustaka formulir asesmen mode presentasi (definisi P07 sebagai data) dan isian hari demo. Morse memakai
 * definisi pustaka bersama (`MORSE_FALL_SCALE`); formulir lain contoh komite rekam medis tanpa kode terminologi
 * (kode baku tidak dikarang, CLAUDE.md §4.10).
 */

const yaTidak = (yaScore?: number) => [
  { value: 'tidak', label: 'Tidak', ...(yaScore !== undefined ? { score: 0 } : {}) },
  { value: 'ya', label: 'Ya', ...(yaScore !== undefined ? { score: yaScore } : {}) },
];

export const ASSESSMENT_FORMS: readonly AssessmentForm[] = [
  {
    code: 'asesmen_awal_medis',
    title: 'Asesmen awal medis',
    category: 'medis',
    writeRoles: ['dokter', 'dokter_residen'],
    kind: 'awal',
    reassessHours: null,
    schema: {
      sections: [
        {
          title: 'Anamnesis',
          fields: [
            { key: 'keluhan_utama', type: 'textarea', label: 'Keluhan utama', required: true, summary: true },
            {
              key: 'riwayat_sekarang',
              type: 'textarea',
              label: 'Riwayat penyakit sekarang',
              required: true,
              summary: false,
            },
            {
              key: 'riwayat_dahulu',
              type: 'textarea',
              label: 'Riwayat penyakit dahulu dan obat rutin',
              required: false,
              summary: false,
            },
          ],
        },
        {
          title: 'Pemeriksaan fisik',
          fields: [
            {
              key: 'keadaan_umum',
              type: 'single',
              label: 'Keadaan umum',
              required: true,
              summary: true,
              options: [
                { value: 'baik', label: 'Baik' },
                { value: 'sedang', label: 'Tampak sakit sedang' },
                { value: 'berat', label: 'Tampak sakit berat' },
              ],
            },
            {
              key: 'pemeriksaan_fisik',
              type: 'textarea',
              label: 'Temuan pemeriksaan fisik',
              required: true,
              summary: false,
            },
          ],
        },
        {
          title: 'Rencana',
          description: 'Diagnosis kerja berkode ICD-10 dicatat di layar Diagnosis.',
          fields: [
            {
              key: 'rencana',
              type: 'textarea',
              label: 'Rencana tata laksana',
              required: true,
              summary: true,
            },
          ],
        },
      ],
    },
  },
  {
    code: 'asesmen_awal_keperawatan',
    title: 'Asesmen awal keperawatan',
    category: 'keperawatan',
    writeRoles: ['perawat', 'bidan'],
    kind: 'awal',
    reassessHours: null,
    schema: {
      sections: [
        {
          title: 'Pengkajian',
          fields: [
            { key: 'keluhan_utama', type: 'textarea', label: 'Keluhan utama', required: true, summary: true },
            {
              key: 'status_fungsional',
              type: 'single',
              label: 'Status fungsional (aktivitas sehari-hari)',
              required: true,
              summary: true,
              options: [
                { value: 'mandiri', label: 'Mandiri' },
                { value: 'sebagian', label: 'Perlu bantuan sebagian' },
                { value: 'penuh', label: 'Perlu bantuan penuh' },
              ],
            },
            {
              key: 'psikososial',
              type: 'single',
              label: 'Status psikologis',
              required: true,
              summary: false,
              options: [
                { value: 'tenang', label: 'Tenang' },
                { value: 'cemas', label: 'Cemas' },
                { value: 'takut', label: 'Takut' },
              ],
            },
          ],
        },
        {
          title: 'Kebutuhan edukasi dan rencana pulang',
          fields: [
            {
              key: 'kebutuhan_edukasi',
              type: 'multi',
              label: 'Kebutuhan edukasi',
              required: true,
              summary: true,
              options: [
                { value: 'penyakit', label: 'Penyakit dan perawatan' },
                { value: 'obat', label: 'Obat' },
                { value: 'diet', label: 'Diet' },
                { value: 'nyeri', label: 'Manajemen nyeri' },
                { value: 'jatuh', label: 'Pencegahan jatuh' },
              ],
            },
            {
              key: 'hambatan_edukasi',
              type: 'single',
              label: 'Hambatan belajar',
              required: true,
              summary: false,
              options: [
                { value: 'tidak_ada', label: 'Tidak ada' },
                { value: 'bahasa', label: 'Bahasa' },
                { value: 'pendengaran', label: 'Pendengaran' },
                { value: 'penglihatan', label: 'Penglihatan' },
              ],
            },
            {
              key: 'rencana_pulang',
              type: 'single',
              label: 'Butuh perencanaan pulang khusus',
              required: true,
              summary: false,
              options: yaTidak(),
            },
          ],
        },
      ],
    },
  },
  {
    code: MORSE_FALL_SCALE.code,
    title: 'Risiko jatuh dewasa (Morse)',
    category: 'keperawatan',
    writeRoles: ['perawat', 'bidan'],
    kind: 'skrining',
    reassessHours: 24,
    schema: MORSE_FALL_SCALE.schema,
  },
  {
    code: 'nyeri_nrs',
    title: 'Skrining nyeri (NRS 0–10)',
    category: 'keperawatan',
    writeRoles: ['perawat', 'bidan', 'dokter', 'dokter_residen'],
    kind: 'skrining',
    reassessHours: 8,
    schema: {
      sections: [
        {
          title: 'Numeric Rating Scale',
          description: '0 = tidak nyeri, 10 = nyeri terberat yang bisa dibayangkan.',
          fields: [
            {
              key: 'skala',
              type: 'single',
              label: 'Skala nyeri saat ini',
              required: true,
              summary: true,
              options: Array.from({ length: 11 }, (_, n) => ({ value: `n${n}`, label: String(n), score: n })),
            },
            {
              key: 'lokasi',
              type: 'text',
              label: 'Lokasi nyeri',
              required: false,
              summary: true,
            },
            {
              key: 'skor_total',
              type: 'score',
              label: 'Skor nyeri (otomatis)',
              required: false,
              summary: true,
            },
          ],
        },
      ],
      scoring: {
        bands: [
          { min: 0, label: 'Tidak nyeri', tone: 'success' },
          { min: 1, label: 'Nyeri ringan', tone: 'success' },
          { min: 4, label: 'Nyeri sedang', tone: 'warning' },
          { min: 7, label: 'Nyeri berat', tone: 'danger' },
        ],
      },
    },
  },
  {
    code: 'skrining_gizi_mst',
    title: 'Skrining gizi (MST)',
    category: 'keperawatan',
    writeRoles: ['perawat', 'bidan'],
    kind: 'skrining',
    reassessHours: 168,
    schema: {
      sections: [
        {
          title: 'Malnutrition Screening Tool',
          fields: [
            {
              key: 'bb_turun',
              type: 'single',
              label: 'Berat badan turun tanpa disengaja dalam 6 bulan terakhir',
              required: true,
              summary: true,
              options: [
                { value: 'tidak', label: 'Tidak', score: 0 },
                { value: 'tidak_yakin', label: 'Tidak yakin', score: 2 },
                { value: 'ya', label: 'Ya', score: 0 },
              ],
            },
            {
              key: 'bb_jumlah',
              type: 'single',
              label: 'Jumlah penurunan berat badan',
              required: true,
              summary: true,
              showWhen: { field: 'bb_turun', equals: 'ya' },
              options: [
                { value: 'kg_1_5', label: '1–5 kg', score: 1 },
                { value: 'kg_6_10', label: '6–10 kg', score: 2 },
                { value: 'kg_11_15', label: '11–15 kg', score: 3 },
                { value: 'kg_15', label: 'Lebih dari 15 kg', score: 4 },
                { value: 'tidak_tahu', label: 'Tidak tahu', score: 2 },
              ],
            },
            {
              key: 'asupan_turun',
              type: 'single',
              label: 'Asupan makan berkurang karena nafsu makan menurun',
              required: true,
              summary: true,
              options: yaTidak(1),
            },
            {
              key: 'skor_total',
              type: 'score',
              label: 'Skor MST (otomatis)',
              required: false,
              summary: true,
            },
          ],
        },
      ],
      scoring: {
        bands: [
          { min: 0, label: 'Tidak berisiko', tone: 'success' },
          { min: 2, label: 'Berisiko malnutrisi', tone: 'warning' },
        ],
      },
    },
  },
];

export function assessmentForm(code: string): AssessmentForm | undefined {
  return ASSESSMENT_FORMS.find((f) => f.code === code);
}

/** Paket formulir per setting (K15 mekanisme paket formulir; keputusan fase 3 no. 18). */
export const ASSESSMENT_PACKAGES: Record<AssessmentSetting, readonly string[]> = {
  'rawat-inap': [
    'asesmen_awal_medis',
    'asesmen_awal_keperawatan',
    'morse_dewasa',
    'nyeri_nrs',
    'skrining_gizi_mst',
  ],
  'rawat-jalan': ['asesmen_awal_medis', 'asesmen_awal_keperawatan', 'nyeri_nrs'],
  'kamar-bersalin': ['asesmen_awal_keperawatan', 'nyeri_nrs', 'morse_dewasa'],
};

/** Jam mulai kunjungan untuk batas asesmen awal (jam admisi; rawat jalan = jam daftar). */
export const ENCOUNTER_START_HM: Readonly<Record<string, string>> = {
  [ENCOUNTER_ID.endang]: '09.30',
  [ENCOUNTER_ID.sutan]: '20.10',
  [ENCOUNTER_ID.rohana]: '07.20',
  [ENCOUNTER_ID.darmawan]: '08.05',
  [ENCOUNTER_ID.dewi]: '07.45',
  [ENCOUNTER_ID.maria]: '07.30',
  [ENCOUNTER_ID.anisa]: '09.40',
};

const T = (hm: string, dayOffset = 0) => at(shiftDate(DEMO_TODAY, dayOffset), hm);
const E = ENCOUNTER_ID;
const melati = doctorById(DOCTOR_ID.melati)?.nama ?? '';

const r = (
  encounterId: string,
  n: number,
  formCode: string,
  by: string,
  atIso: string,
  answers: AssessmentResponse['answers'],
): AssessmentResponse => ({
  id: `${encounterId}-asesmen-${n}`,
  formCode,
  encounterId,
  version: 1,
  answers,
  by,
  at: atIso,
  supersedesId: null,
  reason: null,
});

/** Isian asesmen yang sudah final (hari demo dan hari-hari rawat sebelumnya). */
export const ASSESSMENT_RESPONSES: readonly AssessmentResponse[] = [
  r(E.endang, 1, 'asesmen_awal_keperawatan', STAF_LAIN.perawat[0], T('10.05', -4), {
    keluhan_utama: 'Demam 4 hari, batuk berdahak, sesak saat aktivitas.',
    status_fungsional: 'sebagian',
    psikososial: 'cemas',
    kebutuhan_edukasi: ['penyakit', 'obat', 'diet', 'jatuh'],
    hambatan_edukasi: 'tidak_ada',
    rencana_pulang: 'ya',
  }),
  r(E.endang, 2, 'morse_dewasa', STAF_LAIN.perawat[0], T('10.10', -4), {
    q_riwayat_jatuh: 'tidak',
    q_diag_sekunder: 'ya',
    q_alat_bantu: 'tidak_ada',
    q_infus: 'ya',
    q_gaya_jalan: 'normal',
    q_mental: 'sadar',
  }),
  r(E.endang, 3, 'skrining_gizi_mst', STAF_LAIN.perawat[0], T('10.15', -4), {
    bb_turun: 'tidak',
    asupan_turun: 'ya',
  }),
  r(E.endang, 4, 'asesmen_awal_medis', STAF.dpjpPenyakitDalam, T('10.40', -4), {
    keluhan_utama: 'Demam 4 hari, batuk berdahak, sesak.',
    riwayat_sekarang:
      'Demam naik turun, batuk dahak kuning, sesak memberat sejak 1 hari. GDS di IGD 312 mg/dL.',
    riwayat_dahulu: 'DM tipe 2 (metformin). Alergi amoksisilin (ruam).',
    keadaan_umum: 'sedang',
    pemeriksaan_fisik: 'T 38,6 · RR 24 · SpO2 92% udara bebas. Ronki basah paru kanan bawah.',
    rencana: 'Rawat inap, seftriakson IV, kultur sputum, insulin basal-bolus, foto toraks.',
  }),
  r(E.endang, 5, 'nyeri_nrs', PERSONA.perawat, T('06.00'), { skala: 'n2', lokasi: 'Dada kanan saat batuk' }),
  r(E.sutan, 1, 'asesmen_awal_medis', melati, T('21.00', -1), {
    keluhan_utama: 'Nyeri dada kiri saat istirahat sejak 2 hari.',
    riwayat_sekarang: 'Nyeri dada tekan 15 menit, membaik dengan nitrat. EKG depresi ST lateral.',
    riwayat_dahulu: 'Hipertensi 10 tahun.',
    keadaan_umum: 'sedang',
    pemeriksaan_fisik: 'TD 158/94 · N 88 · ronki tidak ada.',
    rencana: 'Angiografi koroner elektif; konsul PD untuk fungsi ginjal.',
  }),
  r(E.sutan, 2, 'asesmen_awal_keperawatan', STAF_LAIN.perawat[1], T('20.40', -1), {
    keluhan_utama: 'Nyeri dada hilang timbul.',
    status_fungsional: 'mandiri',
    psikososial: 'cemas',
    kebutuhan_edukasi: ['penyakit', 'obat'],
    hambatan_edukasi: 'tidak_ada',
    rencana_pulang: 'tidak',
  }),
  r(E.rohana, 1, 'asesmen_awal_keperawatan', PERSONA.perawat, T('07.36'), {
    keluhan_utama: 'Kontrol pasca rawat pneumonia, batuk sisa.',
    status_fungsional: 'mandiri',
    psikososial: 'tenang',
    kebutuhan_edukasi: ['obat', 'diet'],
    hambatan_edukasi: 'tidak_ada',
    rencana_pulang: 'tidak',
  }),
  r(E.rohana, 2, 'nyeri_nrs', PERSONA.perawat, T('07.38'), { skala: 'n0' }),
  r(E.rohana, 3, 'asesmen_awal_medis', STAF.dpjpPenyakitDalam, T('10.38'), {
    keluhan_utama: 'Kontrol pasca rawat pneumonia, batuk sisa ringan.',
    riwayat_sekarang: 'Pulang rawat 19 Sep; batuk berkurang, tidak demam. GDS pagi 198 mg/dL.',
    riwayat_dahulu: 'DM tipe 2 (metformin, insulin glargine). Alergi amoksisilin.',
    keadaan_umum: 'baik',
    pemeriksaan_fisik: 'TD 132/84 · N 80 · SpO2 98%. Paru bersih.',
    rencana: 'Lanjut terapi DM, titrasi glargine, kontrol 1 bulan.',
  }),
  r(E.anisa, 1, 'asesmen_awal_keperawatan', PERSONA.bidan, T('09.55'), {
    keluhan_utama: 'Hamil 38 minggu, gerak janin berkurang sejak pagi.',
    status_fungsional: 'mandiri',
    psikososial: 'takut',
    kebutuhan_edukasi: ['penyakit', 'nyeri'],
    hambatan_edukasi: 'tidak_ada',
    rencana_pulang: 'tidak',
  }),
];

/**
 * Isian asesmen satu kunjungan. Pasien rawat inap tanpa isian fixture (ICU, bangsal lain) mendapat asesmen awal
 * medis dan keperawatan yang sudah final pada hari masuk, disusun dari riwayat pasien, agar bagan terbuka dalam
 * keadaan kerja yang wajar; skrining berulang dibiarkan jatuh tempo.
 */
export function assessmentResponsesFor(chart: {
  encounterId: string;
  setting: AssessmentSetting;
  startedOn: string;
  dpjp: string;
  riwayat: string;
}): AssessmentResponse[] {
  const own = ASSESSMENT_RESPONSES.filter((x) => x.encounterId === chart.encounterId);
  if (own.length > 0 || chart.setting !== 'rawat-inap') return own;
  const day = (hm: string) => at(chart.startedOn, hm);
  return [
    r(chart.encounterId, 1, 'asesmen_awal_keperawatan', STAF_LAIN.perawat[1], day('10.00'), {
      keluhan_utama: chart.riwayat,
      status_fungsional: 'sebagian',
      psikososial: 'cemas',
      kebutuhan_edukasi: ['penyakit', 'obat'],
      hambatan_edukasi: 'tidak_ada',
      rencana_pulang: 'ya',
    }),
    r(chart.encounterId, 2, 'asesmen_awal_medis', chart.dpjp, day('11.00'), {
      keluhan_utama: chart.riwayat,
      riwayat_sekarang: `Dirawat dengan ${chart.riwayat.toLowerCase()}.`,
      keadaan_umum: 'sedang',
      pemeriksaan_fisik: 'Lihat CPPT dan observasi tanda vital hari masuk.',
      rencana: 'Rawat inap, tata laksana sesuai diagnosis kerja, evaluasi harian.',
    }),
  ];
}
