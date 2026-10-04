import {
  allFields,
  DEFAULT_ROLE_GRANTS,
  FORM_FIELD_TYPES,
  type FormDefinitionStatus,
  type FormField,
  type FormFieldType,
  type FormSchema,
  jakartaParts,
  SYSTEM_ROLES,
} from '@simrs/shared';
import type { ChipTone } from '@simrs/ui';

/**
 * Logika murni pembuat formulir (/sistem/formulir, design/mockups/Formulir.dc.html): operasi skema yang
 * menjaga aturan `formSchemaSchema` (kunci unik, ≥ 2 opsi, logika tampil merujuk field yang ada), terpisah dari
 * komponen agar bisa diuji. Semua operasi mengembalikan objek baru (state React tidak dimutasi).
 */

export const FORM_STATUS_VIEW: Record<FormDefinitionStatus, { label: string; tone: ChipTone }> = {
  draft: { label: 'Draf', tone: 'warning' },
  submitted: { label: 'Diajukan', tone: 'info' },
  published: { label: 'Berlaku', tone: 'success' },
  archived: { label: 'Arsip', tone: 'neutral' },
};

export const PALETTE = (Object.keys(FORM_FIELD_TYPES) as FormFieldType[]).map((type) => ({
  type,
  ...FORM_FIELD_TYPES[type],
}));

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

/** `12 Sep 2026` (WIB). */
export function tanggalPendek(iso: string): string {
  const p = jakartaParts(iso);
  return `${p.day} ${BULAN[p.month - 1]} ${p.year}`;
}

/**
 * Profesi yang bisa diberi hak isi: peran bawaan berizin `forms.response.write`, ditambah peran yang sudah
 * tercantum di definisi (mis. peran khusus RS). API tetap memvalidasi kode peran terhadap peran RS.
 */
export function writeRoleOptions(current: readonly string[] = []): Array<{ code: string; label: string }> {
  const clinical = Object.entries(DEFAULT_ROLE_GRANTS)
    .filter(([, grants]) => grants.some(([r, a]) => r === 'forms.response' && a === 'write'))
    .map(([code]) => code);
  return [...new Set([...clinical, ...current])].map((code) => ({
    code,
    label: (SYSTEM_ROLES as Record<string, string>)[code] ?? code,
  }));
}

// ---------------------------------------------------------------------------------------------------------
// Field dan bagian
// ---------------------------------------------------------------------------------------------------------

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

export function keyProblem(key: string, schema: FormSchema, self: string): string | null {
  if (!KEY_RE.test(key)) return 'Kunci: huruf kecil, angka, garis bawah; diawali huruf (2–41 karakter).';
  if (key !== self && allFields(schema).some((f) => f.key === key)) return 'Kunci sudah dipakai field lain.';
  return null;
}

function nextName(base: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export const hasOptions = (type: FormFieldType) => type === 'single' || type === 'multi';
export const isScored = (f: FormField) => Boolean(f.options?.some((o) => o.score !== undefined));

export function newField(type: FormFieldType, schema: FormSchema): FormField {
  const key = nextName('f_baru', new Set(allFields(schema).map((f) => f.key)));
  return {
    key,
    type,
    label: `${FORM_FIELD_TYPES[type].label} (field baru)`,
    required: false,
    summary: false,
    ...(hasOptions(type)
      ? {
          options: [
            { value: 'opsi_1', label: 'Opsi 1' },
            { value: 'opsi_2', label: 'Opsi 2' },
          ],
        }
      : {}),
  };
}

export function locate(schema: FormSchema, key: string): { section: number; index: number } | null {
  for (const [section, s] of schema.sections.entries()) {
    const index = s.fields.findIndex((f) => f.key === key);
    if (index >= 0) return { section, index };
  }
  return null;
}

const mapFields = (schema: FormSchema, fn: (f: FormField) => FormField): FormSchema => ({
  ...schema,
  sections: schema.sections.map((s) => ({ ...s, fields: s.fields.map(fn) })),
});

/**
 * Sisipkan field tepat di bawah field `after` (field yang sedang dipilih), atau di akhir bagian `section`
 * (bagian terakhir bila di luar rentang).
 */
export function addField(
  schema: FormSchema,
  field: FormField,
  at: { after: string } | { section: number },
): FormSchema {
  const pos = 'after' in at ? locate(schema, at.after) : null;
  if (pos) {
    return {
      ...schema,
      sections: schema.sections.map((s, i) =>
        i === pos.section
          ? { ...s, fields: [...s.fields.slice(0, pos.index + 1), field, ...s.fields.slice(pos.index + 1)] }
          : s,
      ),
    };
  }
  const want = 'section' in at ? at.section : -1;
  const target = want >= 0 && want < schema.sections.length ? want : schema.sections.length - 1;
  return {
    ...schema,
    sections: schema.sections.map((s, i) => (i === target ? { ...s, fields: [...s.fields, field] } : s)),
  };
}

/** Ubah sebagian properti field; nilai `undefined` menghapus properti opsional. */
export function updateField(schema: FormSchema, key: string, patch: Partial<FormField>): FormSchema {
  return mapFields(schema, (f) => {
    if (f.key !== key) return f;
    const next: Record<string, unknown> = { ...f, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return next as FormField;
  });
}

/** Ganti kunci field beserta rujukan logika tampil ke field itu. */
export function renameField(schema: FormSchema, from: string, to: string): FormSchema {
  return mapFields(schema, (f) => ({
    ...f,
    key: f.key === from ? to : f.key,
    ...(f.showWhen?.field === from ? { showWhen: { ...f.showWhen, field: to } } : {}),
  }));
}

/** Hapus field; logika tampil field lain yang merujuknya ikut dilepas (selalu tampil). */
export function removeField(schema: FormSchema, key: string): FormSchema {
  const removed: FormSchema = {
    ...schema,
    sections: schema.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) })),
  };
  return mapFields(removed, (f) => (f.showWhen?.field === key ? dropShowWhen(f) : f));
}

function dropShowWhen(f: FormField): FormField {
  const { showWhen: _, ...rest } = f;
  return rest;
}

/** Geser field satu posisi; di tepi bagian, pindah ke bagian sebelah. */
export function moveField(schema: FormSchema, key: string, dir: -1 | 1): FormSchema {
  const at = locate(schema, key);
  if (!at) return schema;
  const sections = schema.sections.map((s) => ({ ...s, fields: [...s.fields] }));
  const here = sections[at.section];
  const field = here?.fields[at.index];
  if (!here || !field) return schema;
  const to = at.index + dir;
  if (to >= 0 && to < here.fields.length) {
    here.fields.splice(at.index, 1);
    here.fields.splice(to, 0, field);
  } else {
    const other = sections[at.section + dir];
    if (!other) return schema;
    here.fields.splice(at.index, 1);
    if (dir === -1) other.fields.push(field);
    else other.fields.unshift(field);
  }
  return { ...schema, sections };
}

export function canMove(schema: FormSchema, key: string, dir: -1 | 1): boolean {
  const at = locate(schema, key);
  if (!at) return false;
  const len = schema.sections[at.section]?.fields.length ?? 0;
  const inside = dir === -1 ? at.index > 0 : at.index < len - 1;
  return inside || schema.sections[at.section + dir] !== undefined;
}

export function addSection(schema: FormSchema): FormSchema {
  return {
    ...schema,
    sections: [...schema.sections, { title: `Bagian ${schema.sections.length + 1}`, fields: [] }],
  };
}

export function updateSection(
  schema: FormSchema,
  index: number,
  patch: { title?: string; description?: string },
): FormSchema {
  return {
    ...schema,
    sections: schema.sections.map((s, i) => {
      if (i !== index) return s;
      const next = { ...s, ...patch };
      if (!next.description) delete next.description;
      return next;
    }),
  };
}

/** Hanya bagian kosong yang bisa dihapus, dan formulir tetap punya minimal satu bagian. */
export const canRemoveSection = (schema: FormSchema, index: number) =>
  schema.sections.length > 1 && schema.sections[index]?.fields.length === 0;

export function removeSection(schema: FormSchema, index: number): FormSchema {
  if (!canRemoveSection(schema, index)) return schema;
  return { ...schema, sections: schema.sections.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------------------------------------------------
// Opsi
// ---------------------------------------------------------------------------------------------------------

export function addOption(schema: FormSchema, key: string): FormSchema {
  return mapFields(schema, (f) => {
    if (f.key !== key) return f;
    const options = f.options ?? [];
    const value = nextName('opsi', new Set(options.map((o) => o.value)));
    return { ...f, options: [...options, { value, label: `Opsi ${options.length + 1}` }] };
  });
}

export function updateOption(
  schema: FormSchema,
  key: string,
  value: string,
  patch: { label?: string; score?: number | undefined },
): FormSchema {
  return mapFields(schema, (f) => {
    if (f.key !== key) return f;
    return {
      ...f,
      options: f.options?.map((o) => {
        if (o.value !== value) return o;
        const next = { ...o, ...patch };
        if (next.score === undefined) delete next.score;
        return next;
      }),
    };
  });
}

/** Minimal dua opsi; logika tampil yang menunggu opsi ini dilepas. */
export function removeOption(schema: FormSchema, key: string, value: string): FormSchema {
  const field = allFields(schema).find((f) => f.key === key);
  if (!field?.options || field.options.length <= 2) return schema;
  return mapFields(schema, (f) => {
    if (f.key === key) return { ...f, options: f.options?.filter((o) => o.value !== value) };
    return f.showWhen?.field === key && f.showWhen.equals === value ? dropShowWhen(f) : f;
  });
}

// ---------------------------------------------------------------------------------------------------------
// Tampilan
// ---------------------------------------------------------------------------------------------------------

/** Petunjuk isian di kanvas (mockup: kotak putus-putus). */
export function fieldHint(f: FormField): string {
  if (f.type === 'number') {
    const range = f.min !== undefined || f.max !== undefined ? ` ${f.min ?? '…'}–${f.max ?? '…'}` : '';
    return `Angka${range} · ${f.unit ?? 'satuan'}`;
  }
  return FORM_FIELD_TYPES[f.type].hint;
}

/** Pilihan logika tampil: "selalu" atau "bila <field pilihan> = <opsi>". Nilai: `kunci=nilai`. */
export function showWhenChoices(schema: FormSchema, self: string): Array<{ value: string; label: string }> {
  return allFields(schema)
    .filter((f) => f.key !== self && hasOptions(f.type))
    .flatMap((f) =>
      (f.options ?? []).map((o) => ({
        value: `${f.key}=${o.value}`,
        label: `Bila "${f.label || f.key}" = ${o.label || o.value}`,
      })),
    );
}

export function parseShowWhen(value: string): FormField['showWhen'] {
  const [field, equals] = value.split('=');
  return field && equals ? { field, equals } : undefined;
}

export function showWhenLabel(schema: FormSchema, f: FormField): string | null {
  if (!f.showWhen) return null;
  const { field, equals } = f.showWhen;
  const target = allFields(schema).find((x) => x.key === field);
  const option = target?.options?.find((o) => o.value === equals);
  return `Tampil bila "${target?.label || field}" = ${option?.label || equals}`;
}

/**
 * Ringkasan kategori skor seperti mockup: `0–24 rendah · 25–44 sedang · ≥ 45 tinggi`. Kata pertama yang sama
 * di semua label (mis. "Risiko") dihilangkan agar ringkas.
 */
export function bandSummary(bands: ReadonlyArray<{ min: number; label: string }>): string {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const words = sorted.map((b) => b.label.trim().split(/\s+/));
  const first = words[0]?.[0]?.toLowerCase();
  const shared =
    sorted.length > 1 && Boolean(first) && words.every((w) => w.length > 1 && w[0]?.toLowerCase() === first);
  const name = (i: number) =>
    ((shared ? words[i]?.slice(1).join(' ') : sorted[i]?.label.trim()) ?? '').toLowerCase() ||
    '(tanpa label)';
  return sorted
    .map((b, i) => {
      const next = sorted[i + 1];
      return next ? `${b.min}–${next.min - 1} ${name(i)}` : `≥ ${b.min} ${name(i)}`;
    })
    .join(' · ');
}

/** Field/bagian pertama yang membuat draf belum bisa diajukan (dipilih otomatis saat galat). */
export function firstIncomplete(
  schema: FormSchema,
): { kind: 'field'; key: string } | { kind: 'section'; index: number } | null {
  const untitled = schema.sections.findIndex((s) => !s.title);
  if (untitled >= 0) return { kind: 'section', index: untitled };
  const field = allFields(schema).find(
    (f) =>
      !f.label ||
      f.options?.some((o) => !o.label) ||
      (f.type === 'score' && schema.scoring?.bands.some((b) => !b.label)),
  );
  return field ? { kind: 'field', key: field.key } : null;
}

export interface HistoryRow {
  version: number;
  title: string;
  note: string;
  status: string;
  tone: ChipTone;
}

export function historyRows(
  history: ReadonlyArray<{
    version: number;
    status: FormDefinitionStatus;
    changeNote: string;
    createdAt: string;
    publishedAt: string | null;
  }>,
): HistoryRow[] {
  return [...history]
    .sort((a, b) => b.version - a.version)
    .map((h) => ({
      version: h.version,
      title:
        h.status === 'draft' || h.status === 'submitted'
          ? `v${h.version} · draf`
          : `v${h.version} · ${tanggalPendek(h.publishedAt ?? h.createdAt)}`,
      note: h.changeNote,
      status: FORM_STATUS_VIEW[h.status].label,
      tone: FORM_STATUS_VIEW[h.status].tone,
    }));
}
