'use client';

import {
  allFields,
  FORM_CATEGORIES,
  type FormAnswers,
  type FormField,
  type FormSchema,
  fieldVisible,
  formatJam,
  formatTanggalWaktu,
  formReadyProblems,
  scoreForm,
} from '@simrs/shared';
import { Button, Chip, type ChipTone, cx } from '@simrs/ui';
import Link from 'next/link';
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import * as lib from '@/lib/forms';
import type { Definition, FormDetail } from '@/lib/server/forms';
import {
  type FormActionResult,
  newDraftAction,
  saveDraftAction,
  submitDraftAction,
  transitionAction,
} from '../actions';
import {
  FieldPanel,
  Panel,
  SectionPanel,
  settingsProblems,
  VersionHistory,
  VersionSettings,
  type VersionSettingsValue,
} from './panels';

interface Editable extends VersionSettingsValue {
  schema: FormSchema;
}
type Selection = { kind: 'field'; key: string } | { kind: 'section'; index: number } | null;

const snapshot = (d: Definition): Editable => ({
  title: d.title,
  writeRoles: d.writeRoles,
  changeNote: d.changeNote,
  schema: d.schema,
});

function firstSelection(schema: FormSchema): Selection {
  const f = allFields(schema)[0];
  return f ? { kind: 'field', key: f.key } : { kind: 'section', index: 0 };
}

const TONE_TEXT: Record<'success' | 'warning' | 'danger', string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const scoreText = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

/** Tiga kolom (palet · kanvas · properti) mulai lebar ini; di bawahnya properti tampil di bawah field terpilih. */
const WIDE_QUERY = '(min-width: 1280px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/**
 * Pembuat formulir klinis (design/mockups/Formulir.dc.html). Draf diedit lokal lalu disimpan ke API dengan token
 * konkurensi; tombol utama mengikuti siklus versi: Ajukan persetujuan komite → Terbitkan vN → Buat draf vN+1.
 * Pilihan opsi di kanvas hanya pratinjau skor (tidak disimpan).
 */
export function FormBuilder({
  detail,
  canWrite,
  canPublish,
  roleOptions,
}: {
  detail: FormDetail;
  canWrite: boolean;
  canPublish: boolean;
  roleOptions: Array<{ code: string; label: string }>;
}) {
  const { draft, published } = detail;
  const shown = (draft ?? published) as Definition;
  const editable = canWrite && draft?.status === 'draft';
  const token = `${shown.id}:${shown.updatedAt}`;

  const [seen, setSeen] = useState(token);
  const [state, setState] = useState<Editable>(() => snapshot(shown));
  const [saved, setSaved] = useState<Editable>(() => snapshot(shown));
  const [sel, setSel] = useState<Selection>(() => firstSelection(shown.schema));
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  const [pending, startTransition] = useTransition();

  // Versi server berubah (simpan, ajukan, terbit, draf baru): mulai dari data server, pilihan tetap bila ada.
  if (seen !== token) {
    setSeen(token);
    setState(snapshot(shown));
    setSaved(snapshot(shown));
    if (sel?.kind === 'field' && !lib.locate(shown.schema, sel.key)) setSel(firstSelection(shown.schema));
  }

  const dirty = editable && JSON.stringify(state) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const publishedKeys = useMemo(
    () => new Set(published ? allFields(published.schema).map((f) => f.key) : []),
    [published],
  );
  const schema = state.schema;
  const bands = schema.scoring?.bands ?? [];
  // Kartu skor terpisah hanya bila formulir berskor tidak punya field jenis skor (field skor memuat ringkasannya).
  const hasScoreField = allFields(schema).some((f) => f.type === 'score');
  const showScore = !hasScoreField && (bands.length > 0 || allFields(schema).some(lib.isScored));
  const wide = useWide();
  const inline = !wide && !preview;

  const setSchema = (fn: (s: FormSchema) => FormSchema) => {
    setError(null);
    setState((st) => ({ ...st, schema: fn(st.schema) }));
  };

  const run = (call: () => Promise<FormActionResult>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await call();
      if (r.error) setError(r.error);
      else after?.();
    });

  const draftInput = () => ({
    code: detail.code,
    baseUpdatedAt: shown.updatedAt,
    title: state.title,
    writeRoles: state.writeRoles,
    changeNote: state.changeNote,
    schema,
  });

  const settingsError = () => Object.values(settingsProblems(state)).find(Boolean) ?? null;

  const onSave = () => {
    const problem = settingsError();
    if (problem) return setError(problem);
    run(() => saveDraftAction(draftInput()));
  };

  const onSubmit = () => {
    const problems = formReadyProblems(schema);
    if (problems.length > 0) {
      setError(`Belum bisa diajukan: ${problems.join('; ')}.`);
      const first = lib.firstIncomplete(schema);
      if (first) setSel(first);
      return;
    }
    const problem = settingsError();
    if (problem) return setError(problem);
    run(() => submitDraftAction({ ...draftInput(), dirty }));
  };

  /** Field baru disisipkan di bawah field terpilih, atau di akhir bagian terpilih/terakhir. */
  const addOfType = (type: FormField['type']) => {
    const field = lib.newField(type, schema);
    const at =
      sel?.kind === 'field'
        ? { after: sel.key }
        : { section: sel?.kind === 'section' ? sel.index : schema.sections.length - 1 };
    setSchema((s) => lib.addField(s, field, at));
    setSel({ kind: 'field', key: field.key });
  };

  const toggleAnswer = (f: FormField, value: string) => {
    setAnswers((a) => {
      const next = { ...a };
      if (f.type === 'multi') {
        const cur = Array.isArray(a[f.key]) ? (a[f.key] as string[]) : [];
        const list = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
        if (list.length > 0) next[f.key] = list;
        else delete next[f.key];
      } else if (a[f.key] === value) delete next[f.key];
      else next[f.key] = value;
      return next;
    });
  };

  const chip: { label: string; tone: ChipTone } = draft
    ? draft.status === 'submitted'
      ? { label: `Diajukan v${draft.version}`, tone: 'info' }
      : { label: `Draf v${draft.version}`, tone: 'warning' }
    : { label: `Berlaku v${shown.version}`, tone: 'success' };

  let primary: { label: string; onClick: () => void } | null = null;
  if (draft?.status === 'draft' && canWrite) {
    primary = { label: 'Ajukan persetujuan komite', onClick: onSubmit };
  } else if (draft?.status === 'submitted' && canPublish) {
    primary = {
      label: `Terbitkan v${draft.version}`,
      onClick: () =>
        run(
          () => transitionAction({ code: detail.code, baseUpdatedAt: draft.updatedAt, step: 'publish' }),
          () => setJustPublished(true),
        ),
    };
  } else if (!draft && canWrite && published) {
    primary = {
      label: `Buat draf v${published.version + 1}`,
      onClick: () =>
        run(
          () => newDraftAction({ code: detail.code, changeNote: `Salinan dari v${published.version}` }),
          () => setJustPublished(false),
        ),
    };
  }

  const selectedField = sel?.kind === 'field' ? allFields(schema).find((f) => f.key === sel.key) : undefined;
  const summary = <ScoreSummary schema={schema} answers={answers} />;

  // Satu panel properti, dirender di satu tempat: kolom kanan (layar lebar) atau tepat di bawah field/bagian
  // terpilih (tablet), agar properti tidak tertinggal jauh di bawah kanvas.
  const propsPanel = selectedField ? (
    <FieldPanel
      schema={schema}
      field={selectedField}
      isNew={!publishedKeys.has(selectedField.key)}
      editable={editable && !pending}
      setSchema={setSchema}
      onRenamed={(to) => {
        setSchema((s) => lib.renameField(s, selectedField.key, to));
        setSel({ kind: 'field', key: to });
      }}
      onRemoved={() => setSel(null)}
    />
  ) : sel?.kind === 'section' && schema.sections[sel.index] ? (
    <SectionPanel
      schema={schema}
      index={sel.index}
      editable={editable && !pending}
      setSchema={setSchema}
      onRemoved={() => setSel(null)}
    />
  ) : (
    <Panel title="Properti field terpilih">
      <span className="text-small text-ink-500">Pilih field di kanvas untuk melihat propertinya.</span>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Sistem / <Link href="/sistem/formulir">Formulir klinis</Link> / {FORM_CATEGORIES[shown.category]}
          </span>
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-h1 font-bold tracking-[-0.02em]">
            {state.title || shown.title}
            <Chip tone={chip.tone} className="text-small">
              {chip.label}
            </Chip>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {draft?.status === 'submitted' && draft.submittedAt && (
            <span className="text-caption text-ink-500">
              Diajukan ke Komite RM {formatTanggalWaktu(draft.submittedAt)}
              {draft.submittedBy ? ` oleh ${draft.submittedBy}` : ''}
            </span>
          )}
          {editable && (
            <span aria-live="polite" className="text-caption text-ink-500">
              {pending ? 'Menyimpan…' : dirty ? 'Perubahan belum disimpan' : 'Semua perubahan tersimpan'}
            </span>
          )}
          <Button size="sm" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? 'Kembali ke penyunting' : 'Pratinjau di tablet'}
          </Button>
          {editable && (
            <Button size="sm" disabled={!dirty || pending} onClick={onSave}>
              Simpan draf
            </Button>
          )}
          {draft?.status === 'submitted' && canWrite && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  transitionAction({ code: detail.code, baseUpdatedAt: draft.updatedAt, step: 'withdraw' }),
                )
              }
            >
              Tarik pengajuan
            </Button>
          )}
          {primary && (
            <Button size="sm" variant="primary" disabled={pending} onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-[12px] border border-danger-border bg-gradient-to-r from-danger-bg to-white px-4 py-3 font-semibold text-danger"
        >
          {error}
        </div>
      )}
      {justPublished && !draft && published && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2.5 rounded-[12px] border border-success-border bg-gradient-to-r from-success-bg to-white px-4 py-3"
        >
          <span className="font-bold text-success">
            v{published.version} diterbitkan pukul {formatJam(published.publishedAt ?? new Date())}
          </span>
          <span className="text-small text-ink-700">
            Entri baru memakai versi ini; entri lama tetap ditampilkan dengan versi saat diisi.
          </span>
        </div>
      )}
      {!draft && !justPublished && canWrite && (
        <p className="m-0 text-small text-ink-700">
          Versi berlaku tidak bisa diubah. Buat draf versi berikutnya untuk mengubah formulir.
        </p>
      )}
      {preview && (
        <p className="m-0 text-small text-ink-700">
          Pratinjau lebar tablet: field mengikuti logika tampil sesuai jawaban; jawaban tidak disimpan.
        </p>
      )}

      <div
        className={cx(
          'flex flex-col gap-5',
          !preview && 'xl:grid xl:grid-cols-[210px_minmax(0,1fr)_330px] xl:items-start',
        )}
      >
        {!preview && (
          <aside
            aria-label="Jenis field"
            className="flex flex-col gap-1.5 rounded-card border border-white/95 bg-white/90 shadow-card p-3.5 xl:sticky xl:top-[calc(var(--app-sticky-top,0px)_+_1rem)]"
          >
            <span className="pb-1 text-caption font-semibold tracking-[0.08em] text-ink-500">
              JENIS FIELD
            </span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-1">
              {lib.PALETTE.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  disabled={!editable}
                  aria-label={`Tambah field ${p.label} ke kanvas`}
                  onClick={() => addOfType(p.type)}
                  className="flex min-h-11 cursor-copy items-center gap-2.5 rounded-[8px] border border-line-soft bg-batu-50 px-2.5 py-2 text-left font-[inherit] text-small text-ink-900 disabled:cursor-not-allowed disabled:text-ink-500"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-[22px] w-[30px] flex-none items-center justify-center rounded-[6px] bg-brand-50 font-mono text-[11px] font-semibold text-brand-700"
                  >
                    {p.badge}
                  </span>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="pt-1.5 text-caption text-ink-500">
              {editable
                ? 'Klik jenis field untuk menambahkannya di bawah field yang dipilih.'
                : 'Palet aktif saat ada draf yang bisa diubah.'}
            </span>
          </aside>
        )}

        <section
          aria-label="Kanvas formulir"
          className={cx('flex min-w-0 flex-col gap-3', preview && 'mx-auto w-full max-w-[768px]')}
        >
          <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            {schema.sections.map((section, si) => {
              const sectionOn = !preview && sel?.kind === 'section' && sel.index === si;
              const fields = preview
                ? section.fields.filter((f) => fieldVisible(f, answers))
                : section.fields;
              return (
                // Bagian tidak punya id; urutan bagian adalah identitasnya di kanvas.
                <Fragment key={si}>
                  <div
                    className={cx(
                      'flex flex-col gap-1 rounded-card bg-white/90 px-5 py-4 shadow-card',
                      sectionOn
                        ? 'border-2 border-brand-600 shadow-[0_0_0_4px_color-mix(in_srgb,_var(--color-brand-600)_12%,_transparent)]'
                        : 'border border-line',
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-caption text-ink-500">
                        Bagian {si + 1} dari {schema.sections.length}
                      </span>
                      {!preview && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-pressed={sectionOn}
                          onClick={() => setSel({ kind: 'section', index: si })}
                        >
                          {editable ? 'Ubah bagian' : 'Lihat bagian'}
                        </Button>
                      )}
                    </span>
                    <h2 className="m-0 text-[17px] font-bold">{section.title || '(bagian tanpa judul)'}</h2>
                    {section.description && (
                      <span className="text-small text-ink-700">{section.description}</span>
                    )}
                  </div>
                  {inline && sectionOn && propsPanel}
                  {fields.map((f) => {
                    const on = !preview && sel?.kind === 'field' && sel.key === f.key;
                    return (
                      <Fragment key={f.key}>
                        <FieldCard
                          field={f}
                          schema={schema}
                          on={on}
                          preview={preview}
                          isNew={!publishedKeys.has(f.key)}
                          answers={answers}
                          summary={summary}
                          onPick={() => setSel({ kind: 'field', key: f.key })}
                          onAnswer={(v) => {
                            toggleAnswer(f, v);
                            if (!preview) setSel({ kind: 'field', key: f.key });
                          }}
                        />
                        {inline && on && propsPanel}
                      </Fragment>
                    );
                  })}
                  {section.fields.length === 0 && !preview && (
                    <p className="m-0 rounded-card border border-dashed border-line-strong px-5 py-4 text-small text-ink-500">
                      Bagian ini belum punya field. Klik jenis field di palet untuk menambahkannya.
                    </p>
                  )}
                </Fragment>
              );
            })}

            {showScore && (
              <div className="flex flex-col gap-1 rounded-card border border-brand-200 bg-card-header px-[18px] py-3.5">
                <span className="font-bold">Skor total (otomatis)</span>
                {summary}
              </div>
            )}

            {editable && !preview && (
              <span>
                <Button
                  size="sm"
                  disabled={schema.sections.length >= 20}
                  onClick={() => {
                    setSchema(lib.addSection);
                    setSel({ kind: 'section', index: schema.sections.length });
                  }}
                >
                  Tambah bagian
                </Button>
              </span>
            )}
          </fieldset>
        </section>

        {!preview && (
          <aside
            aria-label="Properti dan versi"
            className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-[calc(var(--app-sticky-top,0px)_+_1rem)] xl:max-h-[calc(100vh_-_var(--app-sticky-top,0px)_-_2rem)] xl:overflow-y-auto"
          >
            {!inline && propsPanel}
            <VersionSettings
              value={state}
              editable={editable && !pending}
              roleOptions={roleOptions}
              onChange={(patch) => {
                setError(null);
                setState((st) => ({ ...st, ...patch }));
              }}
            />
            <VersionHistory rows={lib.historyRows(detail.history)} />
          </aside>
        )}
      </div>
    </div>
  );
}

function FieldCard({
  field: f,
  schema,
  on,
  preview,
  isNew,
  answers,
  summary,
  onPick,
  onAnswer,
}: {
  field: FormField;
  schema: FormSchema;
  on: boolean;
  preview: boolean;
  isNew: boolean;
  answers: FormAnswers;
  /** Ringkasan skor (dipakai field jenis skor: total, kategori, aturan). */
  summary: ReactNode;
  onPick: () => void;
  onAnswer: (value: string) => void;
}) {
  const scored = lib.isScored(f);
  const logic = lib.showWhenLabel(schema, f);
  const value = answers[f.key];
  const label = (
    <span className="font-semibold">
      {f.label || '(tanpa label)'}
      {f.required && (
        <>
          <span aria-hidden="true" className="ml-[0.28em] text-danger">
            *
          </span>
          <span className="sr-only"> (wajib)</span>
        </>
      )}
    </span>
  );
  return (
    <div
      className={cx(
        'flex flex-col gap-2.5 rounded-card px-[18px] py-3.5',
        on
          ? 'border-2 border-brand-600 bg-white/95 shadow-[0_0_0_4px_color-mix(in_srgb,_var(--color-brand-600)_14%,_transparent)]'
          : f.type === 'score'
            ? 'border border-brand-200 bg-card-header'
            : 'border border-white/95 bg-white/90 shadow-card',
      )}
    >
      {preview ? (
        label
      ) : (
        <button
          type="button"
          aria-pressed={on}
          onClick={onPick}
          className="flex w-full cursor-pointer items-baseline justify-between gap-3 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
        >
          {label}
          <span className="font-mono text-caption text-ink-500">{f.key}</span>
        </button>
      )}
      {!preview && (isNew || logic) && (
        <span className="flex flex-wrap items-center gap-2 text-caption text-ink-500">
          {isNew && <Chip tone="brand">Field baru</Chip>}
          {logic}
        </span>
      )}
      {f.options && lib.hasOptions(f.type) ? (
        <div className="flex flex-wrap gap-2">
          {f.options.map((o) => {
            const chosen = Array.isArray(value) ? value.includes(o.value) : value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={chosen}
                onClick={() => onAnswer(o.value)}
                className={cx(
                  'min-h-11 cursor-pointer rounded-control px-3 py-[7px] text-left font-[inherit] text-small text-ink-900',
                  chosen ? 'border border-brand-600 bg-brand-50' : 'border border-line-strong bg-white',
                )}
              >
                {o.label || '(opsi tanpa label)'}
                {scored && (
                  <span className="ml-1.5 font-mono font-semibold text-brand-700">
                    {scoreText(o.score ?? 0)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : f.type === 'score' ? (
        summary
      ) : (
        <span className="rounded-control border border-dashed border-line-strong bg-batu-50 px-3 py-[9px] text-small text-ink-500">
          {lib.fieldHint(f)}
        </span>
      )}
    </div>
  );
}

/**
 * Ringkasan skor seperti mockup: kategori (`0–24 rendah · …`), total + kategori terhitung dari pilihan di kanvas,
 * dan aturan tindak lanjut (aktif saat skor mencapai kategori tertinggi).
 */
function ScoreSummary({ schema, answers }: { schema: FormSchema; answers: FormAnswers }) {
  const score = scoreForm(schema, answers);
  const bands = schema.scoring?.bands ?? [];
  const topBand = [...bands].sort((a, b) => b.min - a.min)[0];
  const ruleActive = Boolean(score.band && topBand && score.band.label === topBand.label);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-small text-ink-700">
          {bands.length > 0 ? lib.bandSummary(bands) : 'Belum ada kategori skor'}
        </span>
        <span aria-live="polite" className="flex items-center gap-2.5">
          {score.answered > 0 ? (
            <>
              <span
                className={cx(
                  'font-mono text-[26px] leading-none font-bold',
                  score.band ? TONE_TEXT[score.band.tone] : 'text-ink-900',
                )}
              >
                {score.total}
              </span>
              <span className="flex flex-col items-start gap-0.5">
                {score.band && <Chip tone={score.band.tone}>{score.band.label}</Chip>}
                <span className="text-caption text-ink-500">
                  {score.answered} dari {score.scored} pertanyaan terjawab
                </span>
              </span>
            </>
          ) : (
            <span className="text-caption text-ink-500">Pilih jawaban di kanvas untuk mencoba skor</span>
          )}
        </span>
      </div>
      {schema.scoring?.rule && (
        <span className={cx('text-small', ruleActive ? 'font-semibold text-danger' : 'text-ink-700')}>
          {ruleActive ? `Aturan aktif: ${schema.scoring.rule}` : `Aturan: ${schema.scoring.rule}`}
        </span>
      )}
    </div>
  );
}
