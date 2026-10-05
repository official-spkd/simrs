import {
  allFields,
  type FormAnswers,
  type FormAnswerValue,
  type FormField,
  type FormSchema,
  fieldVisible,
  jakartaParts,
} from '@simrs/shared';

/**
 * Logika murni penyaji formulir P07 untuk klinisi (`components/forms/form-renderer.tsx`): perubahan jawaban yang
 * selalu menghasilkan isian sah menurut `validateAnswers` (jawaban kosong dihapus, jawaban field yang tersembunyi oleh
 * logika tampil ikut dibuang), serta konversi tanggal/jam WIB untuk `<input type="datetime-local">`. Terpisah dari
 * komponen agar bisa diuji; semua fungsi mengembalikan objek baru.
 */

const isEmpty = (v: FormAnswerValue | undefined) =>
  v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Buang jawaban field yang tidak tampil (logika tampil berantai: field A menyembunyikan B, B menyembunyikan C) dan
 * jawaban untuk kunci yang tidak ada di definisi. API menolak keduanya (`validateAnswers`), jadi penyaji tidak
 * pernah mengirimnya.
 */
export function pruneAnswers(schema: FormSchema, answers: FormAnswers): FormAnswers {
  const fields = allFields(schema);
  const known = new Set(fields.map((f) => f.key));
  let current: FormAnswers = Object.fromEntries(
    Object.entries(answers).filter(([k, v]) => known.has(k) && !isEmpty(v)),
  );
  // Setiap putaran membuang minimal satu kunci, jadi berhenti paling lama setelah sebanyak jumlah field.
  for (let i = 0; i <= fields.length; i += 1) {
    const hidden = fields.filter((f) => current[f.key] !== undefined && !fieldVisible(f, current));
    if (hidden.length === 0) break;
    const drop = new Set(hidden.map((f) => f.key));
    current = Object.fromEntries(Object.entries(current).filter(([k]) => !drop.has(k)));
  }
  return current;
}

/** Ganti jawaban satu field (nilai kosong = hapus), lalu rapikan jawaban field yang jadi tersembunyi. */
export function setAnswer(
  schema: FormSchema,
  answers: FormAnswers,
  key: string,
  value: FormAnswerValue | undefined,
): FormAnswers {
  const next: FormAnswers = { ...answers };
  if (isEmpty(value)) delete next[key];
  else next[key] = value as FormAnswerValue;
  return pruneAnswers(schema, next);
}

/** Centang/lepas satu opsi pilihan ganda (urutan mengikuti urutan opsi di definisi). */
export function toggleOption(
  field: FormField,
  current: FormAnswerValue | undefined,
  value: string,
): string[] {
  const chosen = new Set(Array.isArray(current) ? current : []);
  if (chosen.has(value)) chosen.delete(value);
  else chosen.add(value);
  return (field.options ?? []).map((o) => o.value).filter((v) => chosen.has(v));
}

/** Ketikan angka (koma desimal boleh): kosong → undefined (hapus jawaban), selain angka hingga → undefined. */
export function parseNumberInput(raw: string): number | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Jawaban tanggal/jam (ISO 8601) → nilai `datetime-local` dalam WIB (`2026-10-05T10:45`); tak valid → kosong. */
export function wibInputValue(value: FormAnswerValue | undefined): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '';
  const p = jakartaParts(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${p.hour}:${p.minute}`;
}

/**
 * Nilai `datetime-local` (jam dinding WIB, tanpa zona) → ISO 8601 berzona `+07:00`, sehingga jawaban tetap benar
 * walau zona waktu peramban bukan Asia/Jakarta. Kosong atau format lain → undefined (hapus jawaban).
 */
export function fromWibInput(raw: string): string | undefined {
  return LOCAL_INPUT.test(raw) ? `${raw}:00+07:00` : undefined;
}
