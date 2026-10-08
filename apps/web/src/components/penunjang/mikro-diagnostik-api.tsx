'use client';

import {
  DIAGNOSTIC_FORMS,
  DIAGNOSTIC_KIND_LABEL,
  type DiagnosticWorklistItem,
  MICRO_REPORT_STAGES,
  MICRO_STAGE_LABEL,
  type MicroOrderRecord,
  type PaWorklist,
  SUSCEPTIBILITY_RESULTS,
} from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { Feedback, type FeedbackMsg } from '@/components/rme/feedback';
import { formatTglJam } from '@/lib/rawat-inap';
import {
  addIsolateAction,
  diagnosticReportAction,
  diagnosticSignAction,
  type LabActionResult,
  microReleaseAction,
  microTechnicalAction,
  paReportAction,
  paSignAction,
} from '@/lib/server/data/penunjang/mikro-diagnostik-actions';

const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';
const FIELD =
  'min-h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small';
const BOX = 'flex flex-col gap-2 rounded-control border border-line-soft bg-white px-3 py-2.5';

function useAction() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const run = (fn: () => Promise<LabActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { busy, msg, run };
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-small font-semibold">
        {label}
      </label>
      {children}
    </span>
  );
}

export interface MicroPerms {
  me: string;
  write: boolean;
  verify: boolean;
  release: boolean;
}

/** Organisme dari daftar lokal (keputusan fase 4 no. 20) sebagai saran isian. */
const ORGANISM_HINTS = [
  'Escherichia coli',
  'Klebsiella pneumoniae',
  'Pseudomonas aeruginosa',
  'Acinetobacter baumannii',
  'Staphylococcus aureus',
  'Staphylococcus koagulase negatif',
  'Streptococcus pneumoniae',
  'Candida albicans',
  'Batang Gram negatif',
  'Kokus Gram positif',
];

/** S02 · Satu order kultur: isolat per tahap, validasi teknis, rilis klinis. */
export function MicroOrderCard({ order: o, perms }: { order: MicroOrderRecord; perms: MicroPerms }) {
  const done = new Set(o.reports.map((r) => r.stage));
  const open = MICRO_REPORT_STAGES.filter((s) => !done.has(s));
  return (
    <article
      aria-label={`Kultur ${o.labNo}`}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">
            {o.patient.name} · <span className="font-mono">{o.labNo}</span>
          </span>
          <span className="text-caption text-ink-500">
            RM <span className="font-mono">{o.patient.mrn}</span> · {o.patient.unitName ?? '–'}
            {o.patient.bed ? ` · ${o.patient.bed}` : ''} · {o.tests.map((t) => t.name).join(', ')}
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {o.priority === 'cito' && <Chip tone="warning">cito</Chip>}
          {o.reports.map((r) => (
            <Chip key={r.id} tone={r.clinicalBy ? 'success' : 'info'}>
              {r.stage}: {r.clinicalBy ? 'dirilis' : 'validasi teknis'}
            </Chip>
          ))}
        </span>
      </header>
      {o.isolates.length > 0 && (
        <ul aria-label="Isolat" className="m-0 flex list-none flex-col gap-1 p-0 text-small">
          {o.isolates.map((i) => (
            <li key={i.id}>
              <strong>{i.organismCode}</strong> ({i.stage}) · {i.growth} · {i.recordedBy.name}
              {i.susceptibilities.length > 0 &&
                ` · ${i.susceptibilities.map((s) => `${s.antibioticCode} ${s.result}${s.micValue !== null ? ` (MIC ${s.micValue})` : ''}`).join(', ')}`}
            </li>
          ))}
        </ul>
      )}
      {o.reports.map((r) => (
        <ReportRow key={r.id} report={r} perms={perms} />
      ))}
      {perms.write && open.length > 0 && <IsolateForm labOrderId={o.labOrderId} stages={open} />}
      {perms.verify && open.length > 0 && <TechnicalForm labOrderId={o.labOrderId} stages={open} />}
    </article>
  );
}

function ReportRow({ report: r, perms }: { report: MicroOrderRecord['reports'][number]; perms: MicroPerms }) {
  const { busy, msg, run } = useAction();
  return (
    <section aria-label={`Laporan ${r.stage}`} className={BOX}>
      <p className="m-0 text-small">
        <strong>{MICRO_STAGE_LABEL[r.stage]}</strong>: {r.conclusion} · teknis {r.technicalBy.name},{' '}
        {formatTglJam(r.technicalAt)}
        {r.clinicalBy && r.clinicalAt
          ? ` · dirilis ${r.clinicalBy.name}, ${formatTglJam(r.clinicalAt)} (TTE)`
          : ''}
      </p>
      <Feedback msg={msg} />
      {!r.clinicalBy && perms.release && r.technicalBy.id !== perms.me && (
        <Button
          variant="primary"
          className="self-start"
          disabled={busy}
          onClick={() => run(() => microReleaseAction(r.id))}
        >
          Rilis klinis {r.stage} (TTE)
        </Button>
      )}
    </section>
  );
}

function IsolateForm({ labOrderId, stages }: { labOrderId: string; stages: readonly ('awal' | 'akhir')[] }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [stage, setStage] = useState(stages[0] ?? 'awal');
  const [organismCode, setOrganism] = useState('');
  const [growth, setGrowth] = useState('');
  const [rows, setRows] = useState<Array<{ antibioticCode: string; result: 'S' | 'I' | 'R'; mic: string }>>(
    [],
  );
  return (
    <form
      aria-label={`Tambah isolat ${labOrderId}`}
      className={BOX}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            addIsolateAction({
              labOrderId,
              stage,
              organismCode,
              growth,
              susceptibilities: stage === 'akhir' ? rows : [],
            }),
          () => {
            setOrganism('');
            setGrowth('');
            setRows([]);
          },
        );
      }}
    >
      <h3 className="m-0 text-small font-semibold">Tambah isolat</h3>
      <Feedback msg={msg} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Tahap" id={`${id}-s`}>
          <select
            id={`${id}-s`}
            value={stage}
            onChange={(e) => setStage(e.target.value as 'awal' | 'akhir')}
            className={SELECT}
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Organisme" id={`${id}-o`}>
          <input
            id={`${id}-o`}
            list={`${id}-ol`}
            value={organismCode}
            onChange={(e) => setOrganism(e.target.value)}
            className={FIELD}
          />
          <datalist id={`${id}-ol`}>
            {ORGANISM_HINTS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </Field>
        <Field label="Pertumbuhan / pewarnaan" id={`${id}-g`}>
          <input
            id={`${id}-g`}
            value={growth}
            onChange={(e) => setGrowth(e.target.value)}
            className={FIELD}
          />
        </Field>
      </div>
      {stage === 'akhir' && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="text-small font-semibold">Uji kepekaan</legend>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input
                aria-label={`Antibiotik ${i + 1}`}
                value={r.antibioticCode}
                onChange={(e) =>
                  setRows((x) => x.map((y, j) => (j === i ? { ...y, antibioticCode: e.target.value } : y)))
                }
                className={FIELD}
              />
              <select
                aria-label={`Hasil ${i + 1}`}
                value={r.result}
                onChange={(e) =>
                  setRows((x) =>
                    x.map((y, j) => (j === i ? { ...y, result: e.target.value as 'S' | 'I' | 'R' } : y)),
                  )
                }
                className={SELECT}
              >
                {SUSCEPTIBILITY_RESULTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                aria-label={`MIC ${i + 1}`}
                inputMode="decimal"
                value={r.mic}
                onChange={(e) =>
                  setRows((x) => x.map((y, j) => (j === i ? { ...y, mic: e.target.value } : y)))
                }
                className={FIELD}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setRows((x) => [...x, { antibioticCode: '', result: 'S', mic: '' }])}
          >
            Tambah antibiotik
          </Button>
        </fieldset>
      )}
      <Button type="submit" className="self-start" disabled={busy}>
        Simpan isolat
      </Button>
    </form>
  );
}

function TechnicalForm({
  labOrderId,
  stages,
}: {
  labOrderId: string;
  stages: readonly ('awal' | 'akhir')[];
}) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [stage, setStage] = useState(stages[0] ?? 'awal');
  const [conclusion, setConclusion] = useState('');
  return (
    <form
      aria-label={`Validasi teknis ${labOrderId}`}
      className={BOX}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => microTechnicalAction({ labOrderId, stage, conclusion }),
          () => setConclusion(''),
        );
      }}
    >
      <h3 className="m-0 text-small font-semibold">Validasi teknis laporan</h3>
      <Feedback msg={msg} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Tahap laporan" id={`${id}-s`}>
          <select
            id={`${id}-s`}
            value={stage}
            onChange={(e) => setStage(e.target.value as 'awal' | 'akhir')}
            className={SELECT}
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kesimpulan" id={`${id}-c`}>
          <input
            id={`${id}-c`}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            className={FIELD}
          />
        </Field>
      </div>
      <Button type="submit" className="self-start" disabled={busy}>
        Validasi teknis
      </Button>
    </form>
  );
}

/** S02 · PA: spesimen kamar operasi → laporan → TTE. */
export function PaItem({ item }: { item: PaWorklist['items'][number] }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const [specimenSite, setSite] = useState(item.site);
  const [macroscopic, setMacro] = useState('');
  const [microscopic, setMicro] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [icd10, setIcd] = useState('');
  const r = item.report;
  return (
    <article aria-label={`Spesimen ${item.labelNo}`} className={BOX}>
      <p className="m-0 text-small">
        <strong>{item.labelNo}</strong> · {item.patient.name} (RM{' '}
        <span className="font-mono">{item.patient.mrn}</span>) · {item.site} · {item.examination} ·{' '}
        {item.clinicalNote}
        {item.cito ? ' · CITO' : ''}
      </p>
      <Feedback msg={msg} />
      {r ? (
        <div className="flex flex-wrap items-center gap-2 text-small">
          <span>
            Diagnosis: <strong>{r.diagnosis}</strong>
            {r.icd10 ? ` (${r.icd10})` : ''} · {r.meta.author.nama}
          </span>
          {r.documentId ? (
            <Chip tone="success">TTE</Chip>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => run(() => paSignAction(r.meta.id))}
            >
              Tandatangani laporan PA (TTE)
            </Button>
          )}
        </div>
      ) : (
        <form
          aria-label={`Laporan PA ${item.labelNo}`}
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              paReportAction({
                encounterId: item.encounterId,
                surgerySpecimenId: item.surgerySpecimenId,
                specimenSite,
                macroscopic,
                microscopic,
                diagnosis,
                icd10,
              }),
            );
          }}
        >
          <Field label="Spesimen" id={`${id}-s`}>
            <input
              id={`${id}-s`}
              value={specimenSite}
              onChange={(e) => setSite(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="Makroskopik" id={`${id}-ma`}>
            <textarea
              id={`${id}-ma`}
              value={macroscopic}
              onChange={(e) => setMacro(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="Mikroskopik" id={`${id}-mi`}>
            <textarea
              id={`${id}-mi`}
              value={microscopic}
              onChange={(e) => setMicro(e.target.value)}
              className={FIELD}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Diagnosis" id={`${id}-d`}>
              <input
                id={`${id}-d`}
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="ICD-10 (opsional)" id={`${id}-i`}>
              <input
                id={`${id}-i`}
                value={icd10}
                onChange={(e) => setIcd(e.target.value.toUpperCase())}
                className={FIELD}
              />
            </Field>
          </div>
          <Button type="submit" className="self-start" disabled={busy}>
            Simpan laporan PA
          </Button>
        </form>
      )}
    </article>
  );
}

/** S10 · Satu order diagnostik: isian formulir `diag_<jenis>` + kesimpulan → laporan → TTE. */
export function DiagnosticItem({ item, canSign }: { item: DiagnosticWorklistItem; canSign: boolean }) {
  const id = useId();
  const { busy, msg, run } = useAction();
  const fields = DIAGNOSTIC_FORMS[item.kind].schema.sections.flatMap((s) => s.fields);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [conclusion, setConclusion] = useState('');
  const r = item.report;
  return (
    <article
      aria-label={`Order ${item.name}`}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {DIAGNOSTIC_KIND_LABEL[item.kind]} · {item.patient.name}
        </span>
        <span className="text-caption text-ink-500">
          RM <span className="font-mono">{item.patient.mrn}</span> · {item.patient.unitName ?? '–'} · order{' '}
          {formatTglJam(item.orderedAt)}
        </span>
      </header>
      <Feedback msg={msg} />
      {r ? (
        <div className="flex flex-wrap items-center gap-2 text-small">
          <span>
            Kesimpulan: <strong>{r.conclusion}</strong> · {r.meta.author.nama}
          </span>
          {r.documentId ? (
            <Chip tone="success">TTE · di panel hasil</Chip>
          ) : canSign ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => run(() => diagnosticSignAction(r.meta.id))}
            >
              Tandatangani laporan (TTE)
            </Button>
          ) : (
            <Chip tone="warning">Menunggu TTE dokter</Chip>
          )}
        </div>
      ) : (
        <form
          aria-label={`Laporan ${item.name}`}
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const typed = Object.fromEntries(
              fields
                .filter((f) => (answers[f.key] ?? '') !== '')
                .map((f) => [
                  f.key,
                  f.type === 'number' ? Number(answers[f.key]?.replace(',', '.')) : answers[f.key],
                ]),
            );
            run(() =>
              diagnosticReportAction({
                serviceRequestId: item.serviceRequestId,
                kind: item.kind,
                answers: typed,
                conclusion,
              }),
            );
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} id={`${id}-${f.key}`}>
                {f.type === 'single' ? (
                  <select
                    id={`${id}-${f.key}`}
                    value={answers[f.key] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                    className={SELECT}
                  >
                    <option value="">Pilih…</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    id={`${id}-${f.key}`}
                    value={answers[f.key] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                    className={FIELD}
                  />
                ) : (
                  <input
                    id={`${id}-${f.key}`}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    value={answers[f.key] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                    className={FIELD}
                  />
                )}
              </Field>
            ))}
          </div>
          <Field label="Kesimpulan" id={`${id}-k`}>
            <textarea
              id={`${id}-k`}
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Button type="submit" className="self-start" disabled={busy}>
            Simpan laporan
          </Button>
        </form>
      )}
    </article>
  );
}
