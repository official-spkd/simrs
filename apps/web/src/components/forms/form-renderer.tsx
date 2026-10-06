'use client';

import {
  allFields,
  displayAnswer,
  type FormAnswers,
  type FormAnswerValue,
  type FormField,
  type FormSchema,
  fieldVisible,
  REF_CODE_SYSTEMS,
  scoreForm,
} from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import { type ReactNode, useId, useState } from 'react';
import { fromWibInput, parseNumberInput, setAnswer, toggleOption, wibInputValue } from '@/lib/form-renderer';

/**
 * P07 · Penyaji formulir klinis untuk klinisi (rencana fase 3 potongan 3.0d): mengisi satu versi definisi formulir
 * (asesmen K06, skor PEWS/MEOWS, edukasi, templat persetujuan) yang dibuat komite di layar Formulir klinis.
 *
 * Komponen terkendali: induk memegang `answers` dan menyimpannya (draf klinis / `POST …/forms/:code/responses`);
 * penyaji tidak memanggil server. Setiap perubahan menghasilkan isian yang lolos aturan bentuk `validateAnswers`
 * (jawaban kosong dan jawaban field tersembunyi dibuang), tetapi kewajiban isi tetap diperiksa induk dan API; pesan
 * galat per field dikirim lewat `errors`. Tanpa `onChange` penyaji tampil hanya baca (isian tersimpan).
 *
 * Jenis field yang belum punya kontrol khusus: tanda tangan diisi dengan mengetik nama penanda tangan (pola tablet
 * persetujuan), anotasi tubuh sementara berupa catatan teks lokasi dan temuan.
 */

export interface FormRendererProps {
  schema: FormSchema;
  answers: FormAnswers;
  /** Tanpa `onChange`: hanya baca. */
  onChange?: (answers: FormAnswers) => void;
  /** Pesan galat per kunci field (dari `validateAnswers` atau jawaban API). */
  errors?: Readonly<Record<string, string>>;
  /** Kunci semua kontrol (mis. selama menyimpan). */
  disabled?: boolean;
}

const TONE_TEXT: Record<'success' | 'warning' | 'danger', string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const INPUT =
  'min-h-11 w-full rounded-control border px-3 py-2 font-[inherit] text-ink-900 disabled:bg-subtle disabled:text-ink-500';

/** Atribut yang sama untuk setiap kontrol isian: id label, pesan galat/petunjuk, wajib. */
interface CommonProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="ml-[0.28em] text-danger">
        *
      </span>
      <span className="sr-only"> (wajib)</span>
    </>
  );
}

export function FormRenderer({
  schema,
  answers,
  onChange,
  errors = {},
  disabled = false,
}: FormRendererProps) {
  const base = useId();
  const fields = allFields(schema);
  const hasScoreField = fields.some((f) => f.type === 'score');
  const scored = fields.some((f) => f.options?.some((o) => o.score !== undefined));
  const score = scored ? <ScoreSummary schema={schema} answers={answers} /> : null;

  if (!onChange) return <ReadOnlyForm schema={schema} answers={answers} score={score} />;

  const change = (key: string, value: FormAnswerValue | undefined) =>
    onChange(setAnswer(schema, answers, key, value));

  return (
    <div className="flex flex-col gap-4">
      {schema.sections.map((section, si) => (
        // Bagian tidak punya id; urutan bagian adalah identitasnya dalam satu versi definisi.
        <div key={si} className="rounded-card border border-line bg-white px-5 py-4">
          <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <legend className="mb-3 p-0">
              <span className="block text-[17px] font-bold">{section.title}</span>
              {section.description && (
                <span className="mt-0.5 block text-small font-normal text-ink-700">
                  {section.description}
                </span>
              )}
            </legend>
            {section.fields
              .filter((f) => fieldVisible(f, answers))
              .map((f) =>
                f.type === 'score' ? (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <span className="text-small font-semibold text-ink-700">{f.label}</span>
                    {score}
                  </div>
                ) : (
                  <FieldControl
                    key={f.key}
                    id={`${base}-${f.key}`}
                    field={f}
                    value={answers[f.key]}
                    error={errors[f.key] ?? null}
                    onChange={(v) => change(f.key, v)}
                  />
                ),
              )}
          </fieldset>
        </div>
      ))}
      {score && !hasScoreField && (
        <div className="flex flex-col gap-1.5 rounded-card border border-line bg-white px-5 py-4">
          <span className="font-bold">Skor total (otomatis)</span>
          {score}
        </div>
      )}
    </div>
  );
}

function FieldControl({
  id,
  field: f,
  value,
  error,
  onChange,
}: {
  id: string;
  field: FormField;
  value: FormAnswerValue | undefined;
  error: string | null;
  onChange: (value: FormAnswerValue | undefined) => void;
}) {
  const msgId = `${id}-msg`;
  const hint = fieldHint(f);
  const described = error || hint ? msgId : undefined;
  const message = (error || hint) && (
    <span id={msgId} className={cx('text-caption', error ? 'text-danger' : 'text-ink-500')}>
      {error ?? hint}
    </span>
  );
  const tone = error ? 'border-danger bg-koral-50' : 'border-line-strong bg-white';

  if ((f.type === 'single' || f.type === 'multi') && f.options) {
    const multi = f.type === 'multi';
    const withScore = f.options.some((o) => o.score !== undefined);
    return (
      <fieldset
        aria-describedby={described}
        aria-invalid={error ? true : undefined}
        className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
      >
        <legend className="mb-1 p-0 text-small font-semibold text-ink-700">
          {f.label}
          {f.required && <RequiredMark />}
        </legend>
        <div className="flex flex-wrap gap-2">
          {f.options.map((o) => {
            const chosen = Array.isArray(value) ? value.includes(o.value) : value === o.value;
            return (
              <label
                key={o.value}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-small text-ink-900 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600',
                  chosen ? 'border-brand-600 bg-brand-50' : 'border-line-strong bg-white',
                )}
              >
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={id}
                  value={o.value}
                  checked={chosen}
                  onChange={() => onChange(multi ? toggleOption(f, value, o.value) : o.value)}
                  className="size-4 accent-brand-600"
                />
                {o.label}
                {withScore && (
                  <span className="font-mono font-semibold text-brand-700">
                    {(o.score ?? 0) < 0 ? `−${-(o.score ?? 0)}` : `+${o.score ?? 0}`}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {/* Pilihan tunggal yang tidak wajib bisa dikosongkan lagi (radio asli tidak bisa dilepas). */}
        {!multi && !f.required && value !== undefined && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="min-h-11 self-start border-0 bg-transparent px-0 text-small text-brand-700 underline"
          >
            Kosongkan pilihan
          </button>
        )}
        {message}
      </fieldset>
    );
  }

  const label = (
    <label htmlFor={id} className="text-small font-semibold text-ink-700">
      {f.label}
      {f.required && <RequiredMark />}
    </label>
  );
  const common: CommonProps = {
    id,
    'aria-describedby': described,
    'aria-invalid': error ? true : undefined,
    'aria-required': f.required || undefined,
  };

  let control: ReactNode;
  switch (f.type) {
    case 'textarea':
    case 'bodymap':
      control = (
        <textarea
          {...common}
          rows={f.type === 'bodymap' ? 3 : 4}
          maxLength={5000}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={cx(INPUT, tone, 'resize-y')}
        />
      );
      break;
    case 'number':
      control = (
        <NumberInput
          common={common}
          className={cx(INPUT, tone)}
          unit={f.unit}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
        />
      );
      break;
    case 'datetime':
      control = (
        <input
          {...common}
          type="datetime-local"
          value={wibInputValue(value)}
          onChange={(e) => onChange(fromWibInput(e.target.value))}
          className={cx(INPUT, tone, 'sm:max-w-xs')}
        />
      );
      break;
    case 'icd10':
      control = (
        <input
          {...common}
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={8}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value.trim().toUpperCase())}
          className={cx(INPUT, tone, 'font-mono sm:max-w-xs')}
        />
      );
      break;
    default:
      // text, signature (nama penanda tangan)
      control = (
        <input
          {...common}
          type="text"
          maxLength={f.type === 'signature' ? 120 : 500}
          autoComplete={f.type === 'signature' ? 'name' : 'off'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={cx(INPUT, tone)}
        />
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {control}
      {message}
    </div>
  );
}

/** Petunjuk isian per jenis field (rentang angka, format kode, cara tanda tangan). */
function fieldHint(f: FormField): string | null {
  switch (f.type) {
    case 'number':
      return f.min !== undefined || f.max !== undefined
        ? `Rentang ${f.min ?? '…'}–${f.max ?? '…'}${f.unit ? ` ${f.unit}` : ''}`
        : null;
    case 'datetime':
      return 'Tanggal dan jam WIB';
    case 'icd10':
      return `Kode ICD-10: ${REF_CODE_SYSTEMS.icd10.hint}`;
    case 'signature':
      return 'Ketik nama lengkap penanda tangan sebagai tanda tangan';
    case 'bodymap':
      return 'Tuliskan lokasi pada tubuh dan temuannya (gambar anotasi belum tersedia)';
    default:
      return null;
  }
}

/**
 * Angka + satuan. Teks ketikan disimpan lokal agar isian antara (mis. "37," atau "-") tidak dihapus saat diketik;
 * hanya angka hingga yang diteruskan ke induk.
 */
function NumberInput({
  common,
  className,
  unit,
  value,
  onChange,
}: {
  common: CommonProps;
  className: string;
  unit: string | undefined;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const [raw, setRaw] = useState(value === undefined ? '' : String(value));
  // Nilai dari induk berubah (mis. muat draf, jawaban dibuang logika tampil): ikuti nilai induk.
  const shown = parseNumberInput(raw) === value ? raw : value === undefined ? '' : String(value);
  return (
    <span className="flex items-center gap-2 sm:max-w-xs">
      <input
        {...common}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(parseNumberInput(e.target.value));
        }}
        className={className}
      />
      {unit && <span className="shrink-0 text-small text-ink-700">{unit}</span>}
    </span>
  );
}

/** Skor otomatis: total, kategori (teks, bukan hanya warna), jumlah terjawab, dan aturan tindak lanjut. */
function ScoreSummary({ schema, answers }: { schema: FormSchema; answers: FormAnswers }) {
  const score = scoreForm(schema, answers);
  const bands = schema.scoring?.bands ?? [];
  const top = [...bands].sort((a, b) => b.min - a.min)[0];
  const ruleActive = Boolean(score.band && top && score.band.label === top.label);
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      {score.answered > 0 ? (
        <span className="flex flex-wrap items-center gap-2.5">
          <span
            className={cx(
              'font-mono text-[26px] leading-none font-bold',
              score.band ? TONE_TEXT[score.band.tone] : 'text-ink-900',
            )}
          >
            {score.total}
          </span>
          {score.band && <Chip tone={score.band.tone}>{score.band.label}</Chip>}
          <span className="text-caption text-ink-500">
            {score.answered} dari {score.scored} pertanyaan terjawab
          </span>
        </span>
      ) : (
        <span className="text-small text-ink-500">Skor dihitung otomatis setelah pertanyaan dijawab.</span>
      )}
      {schema.scoring?.rule && ruleActive && (
        <span className="text-small font-semibold text-danger">Tindak lanjut: {schema.scoring.rule}</span>
      )}
    </div>
  );
}

/** Isian tersimpan: label dan jawaban (label opsi, bukan kodenya) per bagian; field tersembunyi tidak tampil. */
function ReadOnlyForm({
  schema,
  answers,
  score,
}: {
  schema: FormSchema;
  answers: FormAnswers;
  score: ReactNode;
}) {
  const hasScoreField = allFields(schema).some((f) => f.type === 'score');
  return (
    <div className="flex flex-col gap-4">
      {schema.sections.map((section, si) => (
        <section key={si} className="flex flex-col gap-2 rounded-card border border-line bg-white px-5 py-4">
          <h3 className="m-0 text-[17px] font-bold">{section.title}</h3>
          <dl className="m-0 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {section.fields
              .filter((f) => fieldVisible(f, answers))
              .map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-small font-semibold text-ink-700">{f.label}</dt>
                  <dd className="m-0 text-small text-ink-900">
                    {f.type === 'score' ? score : displayAnswer(f, answers[f.key])}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
      {score && !hasScoreField && (
        <section className="flex flex-col gap-1.5 rounded-card border border-line bg-white px-5 py-4">
          <h3 className="m-0 text-[17px] font-bold">Skor total (otomatis)</h3>
          {score}
        </section>
      )}
    </div>
  );
}
