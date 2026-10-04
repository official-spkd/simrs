'use client';

import { FORM_FIELD_TYPES, type FormField, type FormSchema } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { type ReactNode, useState } from 'react';
import * as lib from '@/lib/forms';

/** Panel kanan pembuat formulir: properti field/bagian, pengaturan versi, riwayat versi. */

export type SchemaUpdate = (fn: (s: FormSchema) => FormSchema) => void;

/** Gaya dasar input; lebar diatur pemakai (penuh, atau flex di baris opsi/kategori). */
const INPUT =
  'h-10 min-w-0 rounded-control border bg-white px-2.5 font-[inherit] text-ink-900 disabled:bg-subtle disabled:text-ink-700';

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-card border border-line bg-card px-[18px] py-4"
    >
      <h2 className="m-0 text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function TextInput({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  mono,
  placeholder,
  maxLength,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string;
  mono?: boolean;
  placeholder?: string;
  maxLength: number;
  onBlur?: () => void;
}) {
  const msg = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-semibold">
        {label}
      </label>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={msg ? `${id}-msg` : undefined}
        autoComplete="off"
        spellCheck={!mono}
        className={cx(
          INPUT,
          'w-full',
          mono && 'font-mono text-small',
          error ? 'border-danger' : 'border-line-strong',
        )}
      />
      {msg && (
        <span
          id={`${id}-msg`}
          role={error ? 'alert' : undefined}
          className={cx('text-caption', error ? 'font-semibold text-danger' : 'text-ink-500')}
        >
          {msg}
        </span>
      )}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2.5 text-small">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] accent-brand-600"
      />
      {label}
    </label>
  );
}

const intOrUndefined = (v: string, lo: number, hi: number): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
};

const numOrUndefined = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const IconButton = ({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className="size-10 shrink-0 cursor-pointer rounded-control border border-line-strong bg-white font-[inherit] text-[18px] leading-none text-ink-700 disabled:cursor-not-allowed disabled:text-ink-400"
  >
    ×
  </button>
);

/** Kunci field baru bisa diganti (diterapkan saat fokus pindah bila sah dan unik). */
function KeyInput({
  schema,
  fieldKey,
  onRename,
}: {
  schema: FormSchema;
  fieldKey: string;
  onRename: (to: string) => void;
}) {
  const [text, setText] = useState(fieldKey);
  const problem = text === fieldKey ? null : lib.keyProblem(text, schema, fieldKey);
  return (
    <TextInput
      id="pKey"
      label="Kunci field"
      mono
      maxLength={41}
      value={text}
      onChange={(v) => setText(v.toLowerCase())}
      onBlur={() => {
        if (text !== fieldKey && !problem) onRename(text);
      }}
      error={problem}
      hint="Dipakai data isian dan integrasi; tidak bisa diubah setelah formulir terbit."
    />
  );
}

export function FieldPanel({
  schema,
  field,
  isNew,
  editable,
  setSchema,
  onRenamed,
  onRemoved,
}: {
  schema: FormSchema;
  field: FormField;
  isNew: boolean;
  editable: boolean;
  setSchema: SchemaUpdate;
  onRenamed: (to: string) => void;
  onRemoved: () => void;
}) {
  const key = field.key;
  const update = (patch: Partial<FormField>) => setSchema((s) => lib.updateField(s, key, patch));
  const choices = lib.showWhenChoices(schema, key);
  const showValue = field.showWhen ? `${field.showWhen.field}=${field.showWhen.equals}` : '';
  const known = choices.some((c) => c.value === showValue);
  const bands = schema.scoring?.bands ?? [];
  const setScoring = (scoring: FormSchema['scoring']) =>
    setSchema((s) => {
      const { scoring: _, ...rest } = s;
      return scoring ? { ...rest, scoring } : rest;
    });

  return (
    <Panel title="Properti field terpilih">
      <span className="-mt-2 text-caption text-ink-500">
        {FORM_FIELD_TYPES[field.type].label}
        {isNew ? ' · field baru di versi ini' : ''}
      </span>
      <fieldset disabled={!editable} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <TextInput
          id="pLabel"
          label="Label"
          maxLength={300}
          value={field.label}
          onChange={(v) => update({ label: v })}
          error={field.label.trim() ? null : 'Label wajib diisi sebelum formulir diajukan.'}
        />
        {isNew && editable ? (
          <KeyInput key={key} schema={schema} fieldKey={key} onRename={onRenamed} />
        ) : (
          <span className="text-caption text-ink-500">
            Kunci <span className="font-mono text-ink-700">{key}</span> · tetap antar versi
          </span>
        )}
        <TextInput
          id="pCode"
          label="Kode terminologi"
          mono
          maxLength={200}
          value={field.terminology ?? ''}
          placeholder="Belum dipetakan ke terminologi"
          onChange={(v) => update({ terminology: v || undefined })}
          hint="Dipakai saat mengirim Observation ke SATUSEHAT"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pShow" className="text-small font-semibold">
            Logika tampil
          </label>
          <select
            id="pShow"
            value={showValue}
            onChange={(e) => update({ showWhen: lib.parseShowWhen(e.target.value) })}
            className={cx(INPUT, 'w-full border-line-strong')}
          >
            <option value="">Selalu tampil</option>
            {showValue && !known && <option value={showValue}>{lib.showWhenLabel(schema, field)}</option>}
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {field.type !== 'score' && (
          <Check
            label="Wajib diisi sebelum tanda tangan"
            checked={field.required}
            onChange={(v) => update({ required: v })}
          />
        )}
        <Check
          label="Tampil di ringkasan pasien"
          checked={field.summary}
          onChange={(v) => update({ summary: v })}
        />

        {lib.hasOptions(field.type) && (
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 p-0 text-small font-semibold">Opsi jawaban</legend>
            {(field.options ?? []).map((o, i) => (
              <div key={o.value} className="flex items-center gap-2">
                <input
                  aria-label={`Label opsi ${i + 1}`}
                  value={o.label}
                  maxLength={200}
                  onChange={(e) =>
                    setSchema((s) => lib.updateOption(s, key, o.value, { label: e.target.value }))
                  }
                  aria-invalid={!o.label.trim()}
                  className={cx(INPUT, 'flex-1', o.label.trim() ? 'border-line-strong' : 'border-danger')}
                />
                <input
                  aria-label={`Skor opsi ${i + 1}`}
                  type="number"
                  step={1}
                  min={-1000}
                  max={1000}
                  placeholder="skor"
                  value={o.score ?? ''}
                  onChange={(e) =>
                    setSchema((s) =>
                      lib.updateOption(s, key, o.value, {
                        score: intOrUndefined(e.target.value, -1000, 1000),
                      }),
                    )
                  }
                  className={cx(INPUT, 'w-[4.5rem] flex-none border-line-strong font-mono text-small')}
                />
                <IconButton
                  label={`Hapus opsi ${i + 1}`}
                  disabled={(field.options?.length ?? 0) <= 2}
                  onClick={() => setSchema((s) => lib.removeOption(s, key, o.value))}
                />
              </div>
            ))}
            <span>
              <Button size="sm" onClick={() => setSchema((s) => lib.addOption(s, key))}>
                Tambah opsi
              </Button>
            </span>
            <span className="text-caption text-ink-500">
              Isi skor bila opsi dihitung ke skor total; kosongkan bila tidak berskor. Minimal dua opsi.
            </span>
          </fieldset>
        )}

        {field.type === 'number' && (
          <div className="grid grid-cols-3 gap-2">
            <TextInput
              id="pUnit"
              label="Satuan"
              maxLength={20}
              value={field.unit ?? ''}
              onChange={(v) => update({ unit: v || undefined })}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pMin" className="text-small font-semibold">
                Minimum
              </label>
              <input
                id="pMin"
                type="number"
                value={field.min ?? ''}
                onChange={(e) => update({ min: numOrUndefined(e.target.value) })}
                className={cx(INPUT, 'w-full border-line-strong font-mono text-small')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pMax" className="text-small font-semibold">
                Maksimum
              </label>
              <input
                id="pMax"
                type="number"
                value={field.max ?? ''}
                onChange={(e) => update({ max: numOrUndefined(e.target.value) })}
                className={cx(INPUT, 'w-full border-line-strong font-mono text-small')}
              />
            </div>
          </div>
        )}

        {field.type === 'score' &&
          (schema.scoring ? (
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-1.5 p-0 text-small font-semibold">Kategori skor</legend>
              {bands.map((b, i) => {
                const patch = (p: Partial<typeof b>) =>
                  setScoring({
                    ...schema.scoring,
                    bands: bands.map((x, j) => (j === i ? { ...x, ...p } : x)),
                  });
                return (
                  // Kategori tidak punya id; posisinya dalam daftar adalah identitasnya.
                  <div key={i} className="flex flex-col gap-2 rounded-control border border-line-soft p-2.5">
                    <input
                      aria-label={`Label kategori ${i + 1}`}
                      value={b.label}
                      maxLength={60}
                      placeholder="Label kategori (mis. Risiko tinggi)"
                      aria-invalid={!b.label.trim()}
                      onChange={(e) => patch({ label: e.target.value })}
                      className={cx(INPUT, 'w-full', b.label.trim() ? 'border-line-strong' : 'border-danger')}
                    />
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className="text-small text-ink-700">
                        Skor ≥
                      </span>
                      <input
                        aria-label={`Batas bawah kategori ${i + 1}`}
                        type="number"
                        step={1}
                        value={b.min}
                        onChange={(e) => patch({ min: intOrUndefined(e.target.value, -100000, 100000) ?? 0 })}
                        className={cx(INPUT, 'w-[4.5rem] flex-none border-line-strong font-mono text-small')}
                      />
                      <select
                        aria-label={`Warna kategori ${i + 1}`}
                        value={b.tone}
                        onChange={(e) => patch({ tone: e.target.value as typeof b.tone })}
                        className={cx(INPUT, 'min-w-0 flex-1 border-line-strong text-small')}
                      >
                        <option value="success">Hijau</option>
                        <option value="warning">Kuning</option>
                        <option value="danger">Merah</option>
                      </select>
                      <IconButton
                        label={`Hapus kategori ${i + 1}`}
                        disabled={bands.length <= 1}
                        onClick={() =>
                          setScoring({ ...schema.scoring, bands: bands.filter((_, j) => j !== i) })
                        }
                      />
                    </div>
                  </div>
                );
              })}
              <span>
                <Button
                  size="sm"
                  disabled={bands.length >= 10}
                  onClick={() =>
                    setScoring({
                      ...schema.scoring,
                      bands: [
                        ...bands,
                        { min: Math.max(0, ...bands.map((b) => b.min)) + 1, label: '', tone: 'danger' },
                      ],
                    })
                  }
                >
                  Tambah kategori
                </Button>
              </span>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pRule" className="text-small font-semibold">
                  Aturan tindak lanjut
                </label>
                <textarea
                  id="pRule"
                  rows={3}
                  maxLength={300}
                  value={schema.scoring.rule ?? ''}
                  onChange={(e) => {
                    const { rule: _, ...rest } = schema.scoring ?? { bands };
                    setScoring(e.target.value ? { ...rest, rule: e.target.value } : rest);
                  }}
                  className="resize-y rounded-control border border-line-strong px-2.5 py-2 font-[inherit] disabled:bg-subtle"
                />
                <span className="text-caption text-ink-500">
                  Ditampilkan saat skor mencapai kategori tertinggi (mis. pasang flag risiko di banner
                  pasien).
                </span>
              </div>
            </fieldset>
          ) : (
            <span>
              <Button
                size="sm"
                onClick={() => setScoring({ bands: [{ min: 0, label: 'Risiko rendah', tone: 'success' }] })}
              >
                Atur kategori skor
              </Button>
            </span>
          ))}

        {editable && (
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
            <Button
              size="sm"
              disabled={!lib.canMove(schema, key, -1)}
              onClick={() => setSchema((s) => lib.moveField(s, key, -1))}
            >
              Naikkan
            </Button>
            <Button
              size="sm"
              disabled={!lib.canMove(schema, key, 1)}
              onClick={() => setSchema((s) => lib.moveField(s, key, 1))}
            >
              Turunkan
            </Button>
            {isNew && (
              <Button
                size="sm"
                className="border-danger-border text-danger"
                onClick={() => {
                  setSchema((s) => lib.removeField(s, key));
                  onRemoved();
                }}
              >
                Hapus field dari kanvas
              </Button>
            )}
          </div>
        )}
      </fieldset>
    </Panel>
  );
}

export function SectionPanel({
  schema,
  index,
  editable,
  setSchema,
  onRemoved,
}: {
  schema: FormSchema;
  index: number;
  editable: boolean;
  setSchema: SchemaUpdate;
  onRemoved: () => void;
}) {
  const section = schema.sections[index];
  if (!section) return null;
  const removable = lib.canRemoveSection(schema, index);
  return (
    <Panel title="Properti bagian">
      <fieldset disabled={!editable} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <TextInput
          id="sTitle"
          label="Judul bagian"
          maxLength={200}
          value={section.title}
          onChange={(v) => setSchema((s) => lib.updateSection(s, index, { title: v }))}
          error={section.title.trim() ? null : 'Judul bagian wajib diisi sebelum formulir diajukan.'}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sDesc" className="text-small font-semibold">
            Petunjuk pengisian
          </label>
          <textarea
            id="sDesc"
            rows={3}
            maxLength={500}
            value={section.description ?? ''}
            onChange={(e) => setSchema((s) => lib.updateSection(s, index, { description: e.target.value }))}
            className="resize-y rounded-control border border-line-strong px-2.5 py-2 font-[inherit] disabled:bg-subtle"
          />
        </div>
        {editable && (
          <span className="flex flex-col gap-1.5">
            <span>
              <Button
                size="sm"
                disabled={!removable}
                className="border-danger-border text-danger"
                onClick={() => {
                  setSchema((s) => lib.removeSection(s, index));
                  onRemoved();
                }}
              >
                Hapus bagian
              </Button>
            </span>
            {!removable && (
              <span className="text-caption text-ink-500">
                Hanya bagian kosong yang bisa dihapus; formulir minimal punya satu bagian.
              </span>
            )}
          </span>
        )}
      </fieldset>
    </Panel>
  );
}

export interface VersionSettingsValue {
  title: string;
  writeRoles: string[];
  changeNote: string;
}

export function settingsProblems(v: VersionSettingsValue) {
  return {
    title: v.title.trim().length >= 3 ? null : 'Judul formulir minimal 3 karakter.',
    writeRoles: v.writeRoles.length > 0 ? null : 'Pilih minimal satu profesi yang boleh mengisi.',
    changeNote: v.changeNote.trim().length >= 3 ? null : 'Catatan perubahan minimal 3 karakter.',
  };
}

export function VersionSettings({
  value,
  editable,
  roleOptions,
  onChange,
}: {
  value: VersionSettingsValue;
  editable: boolean;
  roleOptions: Array<{ code: string; label: string }>;
  onChange: (patch: Partial<VersionSettingsValue>) => void;
}) {
  const problems = settingsProblems(value);
  if (!editable) {
    const names = value.writeRoles.map((c) => roleOptions.find((r) => r.code === c)?.label ?? c);
    return (
      <Panel title="Pengaturan versi">
        <dl className="m-0 flex flex-col gap-2 text-small">
          <div className="flex flex-col">
            <dt className="text-ink-500">Profesi yang boleh mengisi</dt>
            <dd className="m-0 font-semibold">{names.join(', ')}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-ink-500">Catatan perubahan</dt>
            <dd className="m-0">{value.changeNote}</dd>
          </div>
        </dl>
      </Panel>
    );
  }
  return (
    <Panel title="Pengaturan versi">
      <TextInput
        id="vTitle"
        label="Judul formulir"
        maxLength={200}
        value={value.title}
        onChange={(v) => onChange({ title: v })}
        error={problems.title}
      />
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-describedby="vRolesMsg">
        <legend className="mb-1.5 p-0 text-small font-semibold">Profesi yang boleh mengisi</legend>
        {roleOptions.map((r) => (
          <Check
            key={r.code}
            label={r.label}
            checked={value.writeRoles.includes(r.code)}
            onChange={(on) =>
              onChange({
                writeRoles: on ? [...value.writeRoles, r.code] : value.writeRoles.filter((c) => c !== r.code),
              })
            }
          />
        ))}
        <span
          id="vRolesMsg"
          role={problems.writeRoles ? 'alert' : undefined}
          className={cx('text-caption', problems.writeRoles ? 'font-semibold text-danger' : 'text-ink-500')}
        >
          {problems.writeRoles ?? 'Hak tulis per profesi diperiksa server saat isian disimpan.'}
        </span>
      </fieldset>
      <TextInput
        id="vNote"
        label="Catatan perubahan"
        maxLength={300}
        value={value.changeNote}
        onChange={(v) => onChange({ changeNote: v })}
        error={problems.changeNote}
        hint="Tampil di riwayat versi"
      />
    </Panel>
  );
}

export function VersionHistory({ rows }: { rows: lib.HistoryRow[] }) {
  return (
    <Panel title="Riwayat versi">
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((v) => (
          <li
            key={v.version}
            className="flex justify-between gap-2.5 border-t border-line-soft pt-2 pb-1 text-small first:border-t-0 first:pt-0"
          >
            <span className="flex flex-col">
              <span className="font-semibold">{v.title}</span>
              <span className="text-caption text-ink-500">{v.note}</span>
            </span>
            <span className="shrink-0">
              <Chip tone={v.tone}>{v.status}</Chip>
            </span>
          </li>
        ))}
      </ul>
      <span className="text-caption text-ink-500">
        Entri lama tetap ditampilkan dengan versi formulir saat diisi (MRMIK 6c).
      </span>
    </Panel>
  );
}
