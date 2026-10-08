import type { CreateFormDefinitionInput } from '../forms';

/**
 * S06 · Asesmen pra-anestesi dan catatan anestesi sebagai formulir P07 (fase 4 §4.7b, ADR-0106). Formulir = data:
 * pustaka di sini dipasang seed sebagai versi 1; komite RM bisa menerbitkan versi baru lewat layar Formulir klinis
 * selama kode dan kunci `asa` tetap. Sign in daftar tilik WHO mewajibkan asesmen pra-anestesi FINAL untuk kunjungan
 * kasus (isian terkini rantai versi, bukan salah entri).
 */

export const PRE_ANESTHESIA_FORM_CODE = 'asesmen_pra_anestesi';
export const ANESTHESIA_RECORD_FORM_CODE = 'catatan_anestesi';
export const ANESTHESIA_FORM_CODES = [PRE_ANESTHESIA_FORM_CODE, ANESTHESIA_RECORD_FORM_CODE] as const;

/** Kelas ASA (nilai opsi field `asa`). */
export const ASA_CLASS_LABEL: Record<string, string> = {
  asa_1: 'ASA I',
  asa_2: 'ASA II',
  asa_3: 'ASA III',
  asa_4: 'ASA IV',
  asa_5: 'ASA V',
  asa_6: 'ASA VI',
};

/** Label kelas ASA dari isian (+ "E" bila operasi darurat), atau null bila kunci tidak ada di versi formulir RS. */
export function asaLabel(answers: Readonly<Record<string, unknown>>): string | null {
  const v = answers.asa;
  if (typeof v !== 'string' || !ASA_CLASS_LABEL[v]) return null;
  return `${ASA_CLASS_LABEL[v]}${answers.darurat === 'ya' ? 'E' : ''}`;
}

export const PRE_ANESTHESIA_FORM: CreateFormDefinitionInput = {
  code: PRE_ANESTHESIA_FORM_CODE,
  title: 'Asesmen pra-anestesi',
  category: 'medis',
  writeRoles: ['dokter'],
  changeNote: 'Pustaka fase 4 (4.7b): syarat sign in daftar tilik WHO',
  schema: {
    sections: [
      {
        title: 'Status fisik',
        description: 'Diisi dokter anestesi sebelum pasien masuk kamar operasi.',
        fields: [
          {
            key: 'asa',
            type: 'single',
            label: 'Kelas ASA',
            required: true,
            summary: true,
            terminology: 'ASA-PS',
            options: [
              { value: 'asa_1', label: 'ASA I · sehat' },
              { value: 'asa_2', label: 'ASA II · penyakit sistemik ringan' },
              { value: 'asa_3', label: 'ASA III · penyakit sistemik berat' },
              { value: 'asa_4', label: 'ASA IV · mengancam jiwa' },
              { value: 'asa_5', label: 'ASA V · moribund' },
              { value: 'asa_6', label: 'ASA VI · donor organ mati batang otak' },
            ],
          },
          {
            key: 'darurat',
            type: 'single',
            label: 'Operasi darurat (E)',
            required: true,
            summary: true,
            options: [
              { value: 'tidak', label: 'Tidak' },
              { value: 'ya', label: 'Ya' },
            ],
          },
          {
            key: 'puasa_sejak',
            type: 'datetime',
            label: 'Mulai puasa',
            required: true,
            summary: false,
            showWhen: { field: 'darurat', equals: 'tidak' },
          },
          {
            key: 'mallampati',
            type: 'single',
            label: 'Jalan napas (Mallampati)',
            required: true,
            summary: false,
            options: [
              { value: 'm1', label: 'I' },
              { value: 'm2', label: 'II' },
              { value: 'm3', label: 'III' },
              { value: 'm4', label: 'IV' },
            ],
          },
          {
            key: 'riwayat_anestesi',
            type: 'textarea',
            label: 'Riwayat anestesi dan penyulit sebelumnya',
            required: false,
            summary: false,
          },
        ],
      },
      {
        title: 'Rencana anestesi',
        fields: [
          {
            key: 'teknik',
            type: 'single',
            label: 'Teknik anestesi',
            required: true,
            summary: true,
            options: [
              { value: 'umum', label: 'Anestesi umum' },
              { value: 'regional', label: 'Regional (spinal/epidural/blok)' },
              { value: 'lokal_sedasi', label: 'Lokal + sedasi' },
            ],
          },
          {
            key: 'rencana',
            type: 'textarea',
            label: 'Rencana anestesi dan pascaanestesi',
            required: true,
            summary: false,
          },
          {
            key: 'persetujuan_anestesi',
            type: 'single',
            label: 'Risiko anestesi dijelaskan dan disetujui pasien/wali',
            required: true,
            summary: false,
            options: [
              { value: 'ya', label: 'Ya' },
              { value: 'tidak', label: 'Belum' },
            ],
          },
        ],
      },
    ],
  },
};

export const ANESTHESIA_RECORD_FORM: CreateFormDefinitionInput = {
  code: ANESTHESIA_RECORD_FORM_CODE,
  title: 'Catatan anestesi',
  category: 'medis',
  writeRoles: ['dokter'],
  changeNote: 'Pustaka fase 4 (4.7b): catatan intraoperatif anestesi',
  schema: {
    sections: [
      {
        title: 'Intraoperatif',
        fields: [
          {
            key: 'teknik',
            type: 'single',
            label: 'Teknik yang dilakukan',
            required: true,
            summary: true,
            options: [
              { value: 'umum', label: 'Anestesi umum' },
              { value: 'regional', label: 'Regional (spinal/epidural/blok)' },
              { value: 'lokal_sedasi', label: 'Lokal + sedasi' },
            ],
          },
          {
            key: 'jalan_napas',
            type: 'single',
            label: 'Jalan napas',
            required: true,
            summary: false,
            options: [
              { value: 'ett', label: 'Pipa endotrakeal' },
              { value: 'lma', label: 'LMA' },
              { value: 'sungkup', label: 'Sungkup muka' },
              { value: 'spontan', label: 'Napas spontan' },
            ],
          },
          { key: 'obat', type: 'textarea', label: 'Obat dan dosis', required: true, summary: false },
          {
            key: 'perdarahan_ml',
            type: 'number',
            label: 'Perkiraan perdarahan',
            required: false,
            summary: false,
            unit: 'mL',
            min: 0,
            max: 20000,
          },
          {
            key: 'penyulit',
            type: 'textarea',
            label: 'Penyulit intraoperatif',
            required: false,
            summary: false,
          },
          {
            key: 'kondisi_akhir',
            type: 'single',
            label: 'Kondisi akhir operasi',
            required: true,
            summary: true,
            options: [
              { value: 'stabil_rr', label: 'Stabil, ke ruang pulih' },
              { value: 'icu', label: 'Ke ICU' },
              { value: 'lainnya', label: 'Lainnya' },
            ],
          },
        ],
      },
    ],
  },
};
