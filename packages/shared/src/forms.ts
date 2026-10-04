import { z } from 'zod';
import { isValidRefCode } from './terminology';

/**
 * P07 · Form engine berversi: formulir klinis adalah DATA (bukan kode), sehingga komite RM bisa memperbarui
 * formulir tanpa rilis aplikasi (MRMIK 6c). Setiap isian menyimpan versi definisi yang dipakai saat diisi.
 * Bentuk JSON ini setara Questionnaire/QuestionnaireResponse FHIR (dipetakan di fase integrasi).
 */

/** Jenis field (palet pembuat formulir): label, lencana, dan petunjuk isian di kanvas. */
export const FORM_FIELD_TYPES = {
  text: { label: 'Teks pendek', badge: 'Aa', hint: 'Isian teks pendek' },
  textarea: { label: 'Teks panjang', badge: '¶', hint: 'Isian teks panjang (paragraf)' },
  number: { label: 'Angka + satuan', badge: '#', hint: 'Angka · satuan' },
  single: { label: 'Pilihan tunggal', badge: '◉', hint: '' },
  multi: { label: 'Pilihan ganda', badge: '☑', hint: '' },
  score: { label: 'Skor terhitung', badge: 'Σ', hint: 'Dihitung otomatis dari field skor' },
  datetime: { label: 'Tanggal / jam', badge: 'D', hint: 'dd/mm/yyyy · jj:mm' },
  icd10: { label: 'Diagnosis ICD-10', badge: 'ICD', hint: 'Cari kode ICD-10' },
  signature: { label: 'Tanda tangan', badge: '✎', hint: 'Area tanda tangan elektronik (TTE)' },
  bodymap: { label: 'Gambar anotasi tubuh', badge: '▦', hint: 'Gambar tubuh untuk anotasi' },
} as const;
export type FormFieldType = keyof typeof FORM_FIELD_TYPES;
export const FORM_FIELD_TYPE_IDS = Object.keys(FORM_FIELD_TYPES) as [FormFieldType, ...FormFieldType[]];

export const FORM_CATEGORIES = {
  keperawatan: 'Keperawatan',
  medis: 'Medis',
  kebidanan: 'Kebidanan',
  umum: 'Umum',
} as const;
export type FormCategory = keyof typeof FORM_CATEGORIES;

export const FORM_DEFINITION_STATUSES = ['draft', 'submitted', 'published', 'archived'] as const;
export type FormDefinitionStatus = (typeof FORM_DEFINITION_STATUSES)[number];

export const FORM_RESPONSE_STATUSES = ['final', 'entered_in_error'] as const;
export type FormResponseStatus = (typeof FORM_RESPONSE_STATUSES)[number];

const KEY = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,40}$/, 'Kunci field: huruf kecil, angka, garis bawah (mis. q_riwayat_jatuh)');

/*
 * Teks yang dilihat petugas (label field/opsi, judul bagian, kategori skor) boleh kosong selama draf agar
 * pekerjaan setengah jadi selalu bisa disimpan; kelengkapannya diperiksa saat diajukan (`formReadyProblems`).
 */
const optionSchema = z.strictObject({
  value: z.string().regex(/^[a-z0-9_]{1,40}$/, 'Nilai opsi: huruf kecil, angka, garis bawah'),
  label: z.string().trim().max(200),
  score: z.number().int().min(-1000).max(1000).optional(),
});

export const formFieldSchema = z.strictObject({
  key: KEY,
  type: z.enum(FORM_FIELD_TYPE_IDS),
  label: z.string().trim().max(300),
  required: z.boolean().default(false),
  /** Tampil di ringkasan pasien. */
  summary: z.boolean().default(false),
  /** Kode terminologi untuk integrasi (mis. LOINC), teks bebas pendek. */
  terminology: z.string().trim().max(200).optional(),
  /** Logika tampil: field hanya tampil (dan wajib) bila field lain bernilai tertentu. */
  showWhen: z.strictObject({ field: KEY, equals: z.string().max(40) }).optional(),
  options: z.array(optionSchema).max(50).optional(),
  unit: z.string().trim().max(20).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

const bandSchema = z.strictObject({
  min: z.number().int(),
  label: z.string().trim().max(60),
  tone: z.enum(['success', 'warning', 'danger']),
});

export const formSchemaSchema = z
  .strictObject({
    sections: z
      .array(
        z.strictObject({
          title: z.string().trim().max(200),
          description: z.string().trim().max(500).optional(),
          fields: z.array(formFieldSchema).max(100),
        }),
      )
      .min(1)
      .max(20),
    scoring: z
      .strictObject({
        /** Kategori skor, urut menaik menurut `min` (0–24 rendah, 25–44 sedang, ≥ 45 tinggi). */
        bands: z.array(bandSchema).min(1).max(10),
        /** Aturan tindak lanjut (teks untuk petugas), mis. bundle pencegahan jatuh. */
        rule: z.string().trim().max(300).optional(),
      })
      .optional(),
  })
  .superRefine((schema, ctx) => {
    const keys = schema.sections.flatMap((s) => s.fields.map((f) => f.key));
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) ctx.addIssue({ code: 'custom', message: `Kunci field ${dup} dipakai lebih dari sekali` });
    for (const f of schema.sections.flatMap((s) => s.fields)) {
      if ((f.type === 'single' || f.type === 'multi') && (!f.options || f.options.length < 2)) {
        ctx.addIssue({ code: 'custom', message: `Field ${f.key} butuh minimal 2 opsi` });
      }
      if (f.showWhen && !keys.includes(f.showWhen.field)) {
        ctx.addIssue({ code: 'custom', message: `Logika tampil ${f.key} merujuk field yang tidak ada` });
      }
    }
  });
export type FormSchema = z.infer<typeof formSchemaSchema>;

export const allFields = (schema: FormSchema): FormField[] => schema.sections.flatMap((s) => s.fields);

/** Masalah yang mencegah draf diajukan ke komite: formulir kosong, judul/label kosong, kategori skor. */
export function formReadyProblems(schema: FormSchema): string[] {
  const fields = allFields(schema);
  const count = (n: number, what: string) => (n > 0 ? [`${n} ${what}`] : []);
  const bands = schema.scoring?.bands ?? [];
  return [
    ...(fields.some((f) => f.type !== 'score') ? [] : ['formulir belum punya field isian']),
    ...count(schema.sections.filter((s) => !s.title).length, 'bagian belum berjudul'),
    ...count(fields.filter((f) => !f.label).length, 'field belum berlabel'),
    ...count(fields.flatMap((f) => f.options ?? []).filter((o) => !o.label).length, 'opsi belum berlabel'),
    ...count(bands.filter((b) => !b.label).length, 'kategori skor belum berlabel'),
    ...(new Set(bands.map((b) => b.min)).size === bands.length ? [] : ['batas kategori skor ganda']),
  ];
}

/** Nilai isian per field: teks, angka, kode opsi, daftar kode opsi (pilihan ganda). */
export type FormAnswerValue = string | number | string[];
export type FormAnswers = Record<string, FormAnswerValue>;

export const formAnswersSchema = z.record(
  KEY,
  z.union([z.string().max(5000), z.number(), z.array(z.string().max(40)).max(50)]),
);

/** Logika tampil: field tampil (dan wajib bila `required`) hanya bila field rujukannya bernilai tertentu. */
export function fieldVisible(field: FormField, answers: FormAnswers): boolean {
  if (!field.showWhen) return true;
  const v = answers[field.showWhen.field];
  return Array.isArray(v) ? v.includes(field.showWhen.equals) : String(v ?? '') === field.showWhen.equals;
}

export interface FormScore {
  total: number;
  /** Jumlah field berskor yang terjawab / seluruhnya. */
  answered: number;
  scored: number;
  band: { label: string; tone: 'success' | 'warning' | 'danger' } | null;
}

/** Skor otomatis: jumlah skor opsi terpilih pada field pilihan yang punya skor. */
export function scoreForm(schema: FormSchema, answers: FormAnswers): FormScore {
  let total = 0;
  let answered = 0;
  let scored = 0;
  for (const f of allFields(schema)) {
    if (!f.options?.some((o) => o.score !== undefined) || !fieldVisible(f, answers)) continue;
    scored += 1;
    const v = answers[f.key];
    const chosen = Array.isArray(v) ? v : v === undefined || v === '' ? [] : [String(v)];
    if (chosen.length > 0) answered += 1;
    for (const c of chosen) total += f.options?.find((o) => o.value === c)?.score ?? 0;
  }
  const bands = [...(schema.scoring?.bands ?? [])].sort((a, b) => a.min - b.min);
  const band = answered > 0 ? ([...bands].reverse().find((b) => total >= b.min) ?? null) : null;
  return { total, answered, scored, band: band ? { label: band.label, tone: band.tone } : null };
}

/**
 * Validasi isian terhadap satu versi definisi: field tak dikenal, wajib (yang tampil), tipe, rentang angka,
 * opsi sah, format tanggal dan kode ICD-10. Mengembalikan pesan per kunci field.
 */
export function validateAnswers(schema: FormSchema, answers: FormAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  const fields = new Map(allFields(schema).map((f) => [f.key, f]));
  for (const key of Object.keys(answers)) {
    if (!fields.has(key)) errors[key] = 'Field tidak ada di versi formulir ini';
  }
  for (const f of fields.values()) {
    if (f.type === 'score') {
      if (answers[f.key] !== undefined) errors[f.key] = 'Skor dihitung otomatis, tidak diisi manual';
      continue;
    }
    const v = answers[f.key];
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    if (!fieldVisible(f, answers)) {
      if (!empty) errors[f.key] = 'Field ini tidak tampil untuk jawaban yang dipilih';
      continue;
    }
    if (empty) {
      if (f.required) errors[f.key] = `${f.label || f.key} wajib diisi`;
      continue;
    }
    const optionValues = new Set(f.options?.map((o) => o.value));
    switch (f.type) {
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errors[f.key] = 'Harus berupa angka';
        else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))
          errors[f.key] = `Di luar rentang ${f.min ?? '−∞'}–${f.max ?? '∞'}`;
        break;
      case 'single':
        if (typeof v !== 'string' || !optionValues.has(v)) errors[f.key] = 'Pilihan tidak dikenal';
        break;
      case 'multi':
        if (!Array.isArray(v) || v.some((x) => !optionValues.has(x)) || new Set(v).size !== v.length)
          errors[f.key] = 'Pilihan tidak dikenal atau ganda';
        break;
      case 'datetime':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) errors[f.key] = 'Tanggal/jam tidak valid';
        break;
      case 'icd10':
        if (typeof v !== 'string' || !isValidRefCode('icd10', v)) errors[f.key] = 'Kode ICD-10 tidak valid';
        break;
      default:
        if (typeof v !== 'string') errors[f.key] = 'Harus berupa teks';
    }
  }
  return errors;
}

/** Nilai isian dalam bentuk teks untuk tampilan dan diff (label opsi, bukan kodenya). */
export function displayAnswer(field: FormField, value: FormAnswerValue | undefined): string {
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  const label = (v: string) => field.options?.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map(label).join(', ');
  if (field.type === 'single') return label(String(value));
  if (field.type === 'number' && field.unit) return `${value} ${field.unit}`;
  return String(value);
}

export interface FormDiffRow {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** Perubahan antar dua versi isian (versi formulir sama): hanya field yang nilainya berbeda. */
export function diffAnswers(schema: FormSchema, before: FormAnswers, after: FormAnswers): FormDiffRow[] {
  return allFields(schema)
    .filter((f) => f.type !== 'score')
    .map((f) => ({
      key: f.key,
      label: f.label || f.key,
      before: displayAnswer(f, before[f.key]),
      after: displayAnswer(f, after[f.key]),
    }))
    .filter((r) => r.before !== r.after);
}

// ---------------------------------------------------------------------------------------------------------
// Skema API (definisi dan isian)
// ---------------------------------------------------------------------------------------------------------

const FORM_CODE = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,40}$/, 'Kode formulir: huruf kecil, angka, garis bawah (mis. morse_dewasa)');
const ROLE_CODE = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/);

export const createFormDefinitionSchema = z.strictObject({
  code: FORM_CODE,
  title: z.string().trim().min(3).max(200),
  category: z.enum(Object.keys(FORM_CATEGORIES) as [FormCategory, ...FormCategory[]]),
  schema: formSchemaSchema,
  writeRoles: z.array(ROLE_CODE).min(1, 'Tentukan profesi yang boleh mengisi').max(20),
  changeNote: z.string().trim().min(3).max(300),
});
/**
 * `baseUpdatedAt` = waktu ubah draf yang sedang dilihat pengguna. Bila draf sudah diubah orang lain sesudahnya,
 * API menolak (409) alih-alih menimpa diam-diam (lost update antar anggota komite).
 */
const BASE = z.iso.datetime().optional();

export const updateFormDraftSchema = z
  .strictObject({
    baseUpdatedAt: BASE,
    title: z.string().trim().min(3).max(200).optional(),
    schema: formSchemaSchema.optional(),
    writeRoles: z.array(ROLE_CODE).min(1).max(20).optional(),
    changeNote: z.string().trim().min(3).max(300).optional(),
  })
  .refine(
    ({ baseUpdatedAt: _, ...v }) => Object.values(v).some((x) => x !== undefined),
    'Minimal satu field diubah',
  );
export const newFormDraftSchema = z.strictObject({ changeNote: z.string().trim().min(3).max(300) });
/** Ajukan, tarik, terbitkan: berlaku atas versi draf yang sedang dilihat. */
export const formTransitionSchema = z.strictObject({ baseUpdatedAt: BASE }).default({});

export const createFormResponseSchema = z.strictObject({ answers: formAnswersSchema });
export const correctFormResponseSchema = z.strictObject({
  answers: formAnswersSchema,
  reason: z.string().trim().min(10, 'Alasan koreksi minimal 10 karakter').max(500),
});
export const voidFormResponseSchema = z.strictObject({
  reason: z.string().trim().min(10, 'Alasan minimal 10 karakter').max(500),
});

export type CreateFormDefinitionInput = z.infer<typeof createFormDefinitionSchema>;
export type UpdateFormDraftInput = z.infer<typeof updateFormDraftSchema>;
export type CreateFormResponseInput = z.infer<typeof createFormResponseSchema>;
export type CorrectFormResponseInput = z.infer<typeof correctFormResponseSchema>;

/**
 * Contoh pustaka formulir: Morse Fall Scale persis seperti `design/mockups/Formulir.dc.html` (butir, opsi, skor,
 * kategori, aturan, kode terminologi). Dipakai seed lokal; RS bisa membuat versi barunya di layar Formulir.
 */
export const MORSE_FALL_SCALE: CreateFormDefinitionInput = {
  code: 'morse_dewasa',
  title: 'Asesmen risiko jatuh dewasa (Morse)',
  category: 'keperawatan',
  writeRoles: ['perawat', 'bidan'],
  changeNote: 'Impor dari formulir kertas',
  schema: {
    sections: [
      {
        title: 'Penilaian Morse Fall Scale',
        description: 'Diisi perawat saat admisi, pindah ruang, perubahan kondisi, dan setelah jatuh.',
        fields: [
          {
            key: 'q_riwayat_jatuh',
            type: 'single',
            label: 'Riwayat jatuh dalam 3 bulan',
            required: true,
            summary: true,
            terminology: 'morse.riwayat_jatuh',
            options: [
              { value: 'tidak', label: 'Tidak', score: 0 },
              { value: 'ya', label: 'Ya', score: 25 },
            ],
          },
          {
            key: 'q_diag_sekunder',
            type: 'single',
            label: 'Diagnosis sekunder (lebih dari satu)',
            required: true,
            summary: true,
            terminology: 'morse.diag_sekunder',
            options: [
              { value: 'tidak', label: 'Tidak', score: 0 },
              { value: 'ya', label: 'Ya', score: 15 },
            ],
          },
          {
            key: 'q_alat_bantu',
            type: 'single',
            label: 'Alat bantu berjalan',
            required: true,
            summary: true,
            terminology: 'morse.alat_bantu',
            options: [
              { value: 'tidak_ada', label: 'Tidak ada / tirah baring / dibantu perawat', score: 0 },
              { value: 'kruk', label: 'Kruk / tongkat / walker', score: 15 },
              { value: 'furnitur', label: 'Berpegangan pada furnitur', score: 30 },
            ],
          },
          {
            key: 'q_infus',
            type: 'single',
            label: 'Terpasang infus atau heparin lock',
            required: true,
            summary: true,
            terminology: 'morse.infus',
            options: [
              { value: 'tidak', label: 'Tidak', score: 0 },
              { value: 'ya', label: 'Ya', score: 20 },
            ],
          },
          {
            key: 'q_gaya_jalan',
            type: 'single',
            label: 'Cara berjalan',
            required: true,
            summary: true,
            terminology: 'morse.gaya_jalan',
            options: [
              { value: 'normal', label: 'Normal / tirah baring', score: 0 },
              { value: 'lemah', label: 'Lemah', score: 10 },
              { value: 'terganggu', label: 'Terganggu', score: 20 },
            ],
          },
          {
            key: 'q_mental',
            type: 'single',
            label: 'Status mental',
            required: true,
            summary: true,
            terminology: 'morse.mental',
            options: [
              { value: 'sadar', label: 'Sadar akan kemampuan', score: 0 },
              { value: 'lupa', label: 'Lupa keterbatasan', score: 15 },
            ],
          },
          {
            key: 'skor_total',
            type: 'score',
            label: 'Skor total (otomatis)',
            required: false,
            summary: true,
            terminology: 'LOINC 59460-6',
          },
        ],
      },
    ],
    scoring: {
      bands: [
        { min: 0, label: 'Risiko rendah', tone: 'success' },
        { min: 25, label: 'Risiko sedang', tone: 'warning' },
        { min: 45, label: 'Risiko tinggi', tone: 'danger' },
      ],
      rule: 'Skor ≥ 45 → tampilkan bundle pencegahan jatuh dan pasang flag "Risiko jatuh tinggi" di banner pasien',
    },
  },
};
