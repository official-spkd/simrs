'use client';

import {
  type FormAnswers,
  type FormSchema,
  formatJam,
  type OperativeReportView,
  SAFETY_REASON_MIN,
  SURGERY_SPECIMEN_EXAM_LABEL,
  SURGERY_SPECIMEN_EXAMS,
  SURGERY_SPECIMEN_FIXATIVE_LABEL,
  SURGERY_SPECIMEN_FIXATIVES,
  type SurgeryCaseView,
  type SurgerySpecimenExam,
  type SurgerySpecimenFixative,
  validateAnswers,
} from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { FormRenderer } from '@/components/forms/form-renderer';
import { AssessmentForm } from '@/components/klinis/assessment-api';
import { parseDiagnosis } from '@/lib/registration-api';
import { anesthesiaRecordAction, reportAction, specimensAction } from './actions-api';
import type { Msg } from './ok-api-panels';

type Done = (m: Msg) => void;
type Result = { ok: true; data: SurgeryCaseView } | { ok: false; message: string; reasons?: string[] };

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-body';
const AREA = 'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]';
const CARD = 'flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 p-4 shadow-card';
const LABEL = 'flex flex-col gap-1 text-caption font-semibold';

function useAct(onDone: Done) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      onDone(r.ok ? { ok: true, text: ok } : { ok: false, text: r.message, reasons: r.reasons });
      if (r.ok) after?.();
    });
  return { pending, run };
}

const TTE: Record<NonNullable<OperativeReportView['signatureStatus']>, string> = {
  signed: 'TTE sah',
  failed: 'TTE gagal',
  pending: 'TTE menunggu penyelenggara',
};
const tteText = (s: OperativeReportView['signatureStatus']) => (s ? TTE[s] : 'TTE belum diminta');

type ReportMode = 'baru' | 'koreksi' | 'addendum';

/**
 * Laporan operasi berversi (4.7/4.7b): operator menulis versi 1 setelah insisi, lalu adendum (tambahan bertanggal, isi
 * asli tetap) atau koreksi beralasan (versi baru menggantikan, alasan ≥ 10 karakter) yang hanya terbuka bila TTE versi
 * itu gagal (versi ber-TTE terkunci, ADR-0028). Setiap versi/adendum ber-TTE operator.
 */
export function ReportPanel({
  c,
  isOperator,
  onDone,
}: {
  c: SurgeryCaseView;
  isOperator: boolean;
  onDone: Done;
}) {
  const [mode, setMode] = useState<ReportMode | null>(null);
  const r = c.report;
  const incised = c.events.some((e) => e.kind === 'insisi');
  return (
    <section aria-label="Laporan operasi" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Laporan operasi</h2>
      {r && (
        <div className="flex flex-col gap-1.5 text-small">
          <p className="m-0">
            Versi {r.version} · {r.author} · {formatJam(r.recordedAt)} · {r.postOpDiagnosis.icd10}{' '}
            {r.postOpDiagnosis.label} · ICD-9-CM {r.procedureCodes.join(', ')} · {tteText(r.signatureStatus)}
          </p>
          {r.correctionReason && (
            <p className="m-0 text-caption text-ink-700">Koreksi: {r.correctionReason}</p>
          )}
          <p className="m-0 whitespace-pre-line text-ink-700">{r.findings}</p>
          <p className="m-0 text-caption text-ink-500">
            Perdarahan {r.bloodLossMl} mL · komplikasi {r.complications || 'tidak ada'} · spesimen PA{' '}
            {r.paSpecimen ? 'ya' : 'tidak'}
          </p>
          {r.addenda.length > 0 && (
            <ul aria-label="Adendum laporan" className="m-0 flex list-none flex-col gap-1 p-0">
              {r.addenda.map((a) => (
                <li key={a.id} className="rounded-control border border-line px-3 py-2">
                  <span className="text-caption font-semibold">
                    Adendum · {a.author} · {formatJam(a.recordedAt)} · {tteText(a.signatureStatus)}
                  </span>
                  <span className="block whitespace-pre-line">{a.findings}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!r && !incised ? (
        <p className="m-0 text-caption text-ink-500">
          Laporan operasi ditulis operator setelah insisi tercatat.
        </p>
      ) : !isOperator ? (
        !r && (
          <p className="m-0 text-caption text-ink-500">
            Laporan operasi ditulis dan ditandatangani operator.
          </p>
        )
      ) : !r ? (
        <ReportForm c={c} mode="baru" base={null} onDone={onDone} onClose={() => undefined} />
      ) : mode ? (
        <ReportForm c={c} mode={mode} base={r} onDone={onDone} onClose={() => setMode(null)} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {r.signatureStatus === 'failed' && (
              <Button size="sm" onClick={() => setMode('koreksi')}>
                Koreksi laporan
              </Button>
            )}
            <Button size="sm" onClick={() => setMode('addendum')}>
              Tambah adendum
            </Button>
          </div>
          {r.signatureStatus !== 'failed' && (
            <p className="m-0 text-caption text-ink-500">
              Versi ber-TTE terkunci: koreksi hanya bila TTE gagal. Lengkapi laporan lewat adendum.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ReportForm({
  c,
  mode,
  base,
  onDone,
  onClose,
}: {
  c: SurgeryCaseView;
  mode: ReportMode;
  base: OperativeReportView | null;
  onDone: Done;
  onClose: () => void;
}) {
  const id = useId();
  const { pending, run } = useAct(onDone);
  const dx = (d: { icd10: string; label: string } | undefined) => (d ? `${d.icd10} ${d.label}` : '');
  const [pre, setPre] = useState(dx(base?.preOpDiagnosis));
  const [post, setPost] = useState(dx(base?.postOpDiagnosis));
  const [codes, setCodes] = useState(base?.procedureCodes.join(', ') ?? c.procedureCode ?? '');
  const [findings, setFindings] = useState(mode === 'koreksi' ? (base?.findings ?? '') : '');
  const [complications, setComplications] = useState(base?.complications ?? '');
  const [blood, setBlood] = useState(String(base?.bloodLossMl ?? 0));
  const [implants, setImplants] = useState(base?.implants ?? '');
  const [pa, setPa] = useState(base?.paSpecimen ?? false);
  const [reason, setReason] = useState('');
  const preDx = parseDiagnosis(pre, null);
  const postDx = parseDiagnosis(post, null);
  const codeList = codes
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const codesOk = codeList.length > 0 && codeList.every((x) => /^\d{2}(\.\d{1,2})?$/.test(x));
  const reasonOk = mode !== 'koreksi' || reason.trim().length >= SAFETY_REASON_MIN;
  const ready =
    !!preDx && !!postDx && codesOk && findings.trim().length >= 5 && /^\d{1,5}$/.test(blood) && reasonOk;
  const addendum = mode === 'addendum';
  const title =
    mode === 'baru'
      ? 'Tulis laporan operasi'
      : addendum
        ? 'Adendum laporan operasi'
        : 'Koreksi laporan operasi';
  return (
    <form
      aria-label={title}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !preDx || !postDx) return;
        const revision =
          mode === 'koreksi' && base
            ? { kind: 'koreksi' as const, supersedesId: base.id, correctionReason: reason.trim() }
            : mode === 'addendum' && base
              ? { kind: 'addendum' as const, addendumOf: base.id }
              : { kind: 'baru' as const };
        run(
          () =>
            reportAction(c.id, {
              preOpDiagnosis: { icd10: preDx.code, label: preDx.display },
              postOpDiagnosis: { icd10: postDx.code, label: postDx.display },
              procedureCodes: codeList,
              findings: findings.trim(),
              complications: complications.trim(),
              bloodLossMl: Number(blood),
              implants: implants.trim(),
              paSpecimen: pa,
              revision,
            }),
          mode === 'baru'
            ? 'Laporan operasi tersimpan; TTE operator diminta.'
            : addendum
              ? 'Adendum laporan tersimpan; TTE operator diminta.'
              : `Koreksi laporan tersimpan sebagai versi ${(base?.version ?? 1) + 1}; TTE operator diminta.`,
          onClose,
        );
      }}
    >
      {mode !== 'baru' && <h3 className="m-0 text-small font-semibold">{title}</h3>}
      {!addendum && (
        <>
          <label htmlFor={`${id}-pre`} className={LABEL}>
            Diagnosa pra-bedah (ICD-10)
            <input id={`${id}-pre`} value={pre} onChange={(e) => setPre(e.target.value)} className={INPUT} />
          </label>
          <label htmlFor={`${id}-post`} className={LABEL}>
            Diagnosa pasca-bedah (ICD-10)
            <input
              id={`${id}-post`}
              value={post}
              onChange={(e) => setPost(e.target.value)}
              className={INPUT}
            />
          </label>
          <label htmlFor={`${id}-icd9`} className={LABEL}>
            Kode tindakan ICD-9-CM (pisahkan koma)
            <input
              id={`${id}-icd9`}
              value={codes}
              onChange={(e) => setCodes(e.target.value)}
              className={INPUT}
            />
          </label>
        </>
      )}
      <label htmlFor={`${id}-find`} className={LABEL}>
        {addendum ? 'Isi adendum' : 'Temuan operasi'}
        <textarea
          id={`${id}-find`}
          rows={3}
          value={findings}
          maxLength={8000}
          onChange={(e) => setFindings(e.target.value)}
          className={AREA}
        />
      </label>
      {!addendum && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={`${id}-comp`} className={LABEL}>
              Komplikasi
              <input
                id={`${id}-comp`}
                value={complications}
                maxLength={2000}
                onChange={(e) => setComplications(e.target.value)}
                className={INPUT}
              />
            </label>
            <label htmlFor={`${id}-blood`} className={LABEL}>
              Perdarahan (mL)
              <input
                id={`${id}-blood`}
                inputMode="numeric"
                value={blood}
                maxLength={5}
                onChange={(e) => setBlood(e.target.value)}
                className={INPUT}
              />
            </label>
          </div>
          <label htmlFor={`${id}-imp`} className={LABEL}>
            Implan
            <input
              id={`${id}-imp`}
              value={implants}
              maxLength={1000}
              onChange={(e) => setImplants(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={pa}
              onChange={(e) => setPa(e.target.checked)}
              className="size-[18px] accent-brand-600"
            />
            Spesimen dikirim ke patologi anatomi
          </label>
        </>
      )}
      {mode === 'koreksi' && (
        <label htmlFor={`${id}-why`} className={LABEL}>
          Alasan koreksi (min. {SAFETY_REASON_MIN} karakter)
          <input
            id={`${id}-why`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className={INPUT}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending || !ready}>
          {mode === 'baru'
            ? 'Simpan dan tanda tangani (TTE operator)'
            : addendum
              ? 'Simpan adendum (TTE operator)'
              : 'Simpan koreksi (TTE operator)'}
        </Button>
        {mode !== 'baru' && (
          <Button type="button" onClick={onClose} disabled={pending}>
            Batal
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Spesimen PA terstruktur (4.7b) dari laporan operasi terkini yang menyatakan ada spesimen. Dikirim operator; setiap
 * spesimen berlabel `OK-…-S<n>` dan diteruskan ke patologi anatomi (event `surgery.specimen_sent`, order PA 4.8).
 */
export function SpecimenPanel({
  c,
  isOperator,
  onDone,
}: {
  c: SurgeryCaseView;
  isOperator: boolean;
  onDone: Done;
}) {
  const id = useId();
  const { pending, run } = useAct(onDone);
  const [site, setSite] = useState('');
  const [exam, setExam] = useState<SurgerySpecimenExam>('histopatologi');
  const [fixative, setFixative] = useState<SurgerySpecimenFixative>('formalin_10');
  const [containers, setContainers] = useState('1');
  const [note, setNote] = useState('');
  const [cito, setCito] = useState(false);
  const r = c.report;
  if (!r) return null;
  const frozenFix = exam === 'potong_beku' && fixative !== 'segar';
  const ready =
    site.trim().length >= 2 && note.trim().length >= 5 && /^([1-9]|1\d|20)$/.test(containers) && !frozenFix;
  return (
    <section aria-label="Spesimen patologi anatomi" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Spesimen patologi anatomi</h2>
      {c.specimens.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
          {c.specimens.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-semibold">{s.labelNo}</span>
              <span>
                {s.site} · {SURGERY_SPECIMEN_EXAM_LABEL[s.examination]} · {s.containers} wadah ·{' '}
                {SURGERY_SPECIMEN_FIXATIVE_LABEL[s.fixative]}
              </span>
              {s.cito && <Chip tone="danger">Cito</Chip>}
              <span className="text-caption text-ink-500">
                dikirim {s.sentBy} · {formatJam(s.sentAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!r.paSpecimen ? (
        <p className="m-0 text-caption text-ink-500">
          Laporan operasi menyatakan tanpa spesimen PA. Koreksi laporan bila ada spesimen.
        </p>
      ) : !isOperator ? (
        c.specimens.length === 0 && (
          <p className="m-0 text-caption text-ink-500">Spesimen dikirim operator dari laporan operasi.</p>
        )
      ) : (
        <form
          aria-label="Kirim spesimen PA"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            run(
              () =>
                specimensAction(c.id, {
                  items: [
                    {
                      site: site.trim(),
                      examination: exam,
                      containers: Number(containers),
                      fixative,
                      clinicalNote: note.trim(),
                      cito,
                    },
                  ],
                }),
              'Spesimen dikirim ke patologi anatomi.',
              () => {
                setSite('');
                setNote('');
                setCito(false);
              },
            );
          }}
        >
          <label htmlFor={`${id}-site`} className={LABEL}>
            Asal jaringan
            <input
              id={`${id}-site`}
              value={site}
              maxLength={200}
              onChange={(e) => setSite(e.target.value)}
              className={INPUT}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={`${id}-exam`} className={LABEL}>
              Pemeriksaan
              <select
                id={`${id}-exam`}
                value={exam}
                onChange={(e) => {
                  const v = e.target.value as SurgerySpecimenExam;
                  setExam(v);
                  if (v === 'potong_beku') setFixative('segar');
                }}
                className={INPUT}
              >
                {SURGERY_SPECIMEN_EXAMS.map((x) => (
                  <option key={x} value={x}>
                    {SURGERY_SPECIMEN_EXAM_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-fix`} className={LABEL}>
              Fiksatif
              <select
                id={`${id}-fix`}
                value={fixative}
                onChange={(e) => setFixative(e.target.value as SurgerySpecimenFixative)}
                className={INPUT}
              >
                {SURGERY_SPECIMEN_FIXATIVES.map((x) => (
                  <option key={x} value={x}>
                    {SURGERY_SPECIMEN_FIXATIVE_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {frozenFix && (
            <p role="alert" className="m-0 text-caption text-danger">
              Potong beku dikirim segar (tanpa fiksatif).
            </p>
          )}
          <label htmlFor={`${id}-n`} className={LABEL}>
            Jumlah wadah
            <input
              id={`${id}-n`}
              inputMode="numeric"
              value={containers}
              maxLength={2}
              onChange={(e) => setContainers(e.target.value)}
              className={INPUT}
            />
          </label>
          <label htmlFor={`${id}-note`} className={LABEL}>
            Diagnosis klinis / pertanyaan untuk patolog
            <textarea
              id={`${id}-note`}
              rows={2}
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              className={AREA}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={cito}
              onChange={(e) => setCito(e.target.checked)}
              className="size-[18px] accent-brand-600"
            />
            Cito
          </label>
          <Button type="submit" variant="primary" disabled={pending || !ready}>
            Kirim spesimen ke PA
          </Button>
        </form>
      )}
    </section>
  );
}

export interface AnesthesiaFormDef {
  code: string;
  title: string;
  version: number;
  schema: FormSchema;
  writeRoles: string[];
}

/**
 * Anestesi (4.7b/4.7c): asesmen pra-anestesi final = syarat sign in (formulir P07 lewat API formulir; hak tulis profesi
 * dokter). Catatan anestesi intraoperatif lewat `POST surgery/cases/:id/anesthesia-records`: hak tulis mengikuti tim
 * kasus (dokter anestesi atau penata anestesi), bukan lingkup unit bangsal. Koreksi isian lewat layar Asesmen.
 */
export function AnesthesiaPanel({
  c,
  forms,
  role,
  userId,
  canWritePre,
  canWriteRecord,
  onDone,
}: {
  c: SurgeryCaseView;
  forms: { pre: AnesthesiaFormDef | null; record: AnesthesiaFormDef | null };
  role: string | null;
  userId: string;
  /** Izin `forms.response.write` sesi. */
  canWritePre: boolean;
  /** Izin `surgery.checklist` sesi. */
  canWriteRecord: boolean;
  onDone: Done;
}) {
  const [open, setOpen] = useState<'pre' | 'record' | null>(null);
  const pre = c.anesthesia.preAssessment;
  const off = c.status === 'batal';
  const preAllowed = canWritePre && !!forms.pre && !!role && forms.pre.writeRoles.includes(role);
  const anesthesiaTeam = c.team.some(
    (t) => t.userId === userId && (t.role === 'anestesi' || t.role === 'penata_anestesi'),
  );
  const recordAllowed =
    canWriteRecord &&
    !!forms.record &&
    (anesthesiaTeam ||
      (!!role && forms.record.writeRoles.includes(role) && c.team.some((t) => t.userId === userId)));
  return (
    <section aria-label="Anestesi" className={CARD}>
      <h2 className="m-0 text-body font-semibold">Anestesi</h2>
      {pre ? (
        <Alert level="success">
          Asesmen pra-anestesi final{pre.asa ? ` · ${pre.asa}` : ''} · {pre.author} ·{' '}
          {formatJam(pre.recordedAt)}
          {pre.version > 1 ? ` (versi ${pre.version})` : ''}
        </Alert>
      ) : (
        <Alert level="warning">
          Asesmen pra-anestesi final belum ada; sign in tertahan sampai dokter anestesi mengisinya.
        </Alert>
      )}
      {c.anesthesia.records.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
          {c.anesthesia.records.map((r) => (
            <li key={r.id}>
              Catatan anestesi · {r.author} · {formatJam(r.recordedAt)}
            </li>
          ))}
        </ul>
      )}
      {!off && (preAllowed || recordAllowed) && (
        <div className="flex flex-wrap gap-2">
          {!pre && preAllowed && (
            <Button size="sm" onClick={() => setOpen(open === 'pre' ? null : 'pre')}>
              Isi asesmen pra-anestesi
            </Button>
          )}
          {recordAllowed && (
            <Button size="sm" onClick={() => setOpen(open === 'record' ? null : 'record')}>
              Isi catatan anestesi
            </Button>
          )}
        </div>
      )}
      {!off && !pre && !preAllowed && canWritePre && (
        <p className="m-0 text-caption text-ink-500">
          Asesmen pra-anestesi diisi dokter (hak tulis profesi).
        </p>
      )}
      {(canWritePre || canWriteRecord) && (!forms.pre || !forms.record) && (
        <p className="m-0 text-caption text-ink-500">
          Formulir {!forms.pre ? 'asesmen pra-anestesi' : 'catatan anestesi'} belum terbit di RS ini (Formulir
          klinis).
        </p>
      )}
      {open === 'pre' && forms.pre && (
        <AssessmentForm
          key={forms.pre.code}
          patientId={c.patient.id}
          encounterId={c.encounterId}
          form={forms.pre}
          allowed={preAllowed}
        />
      )}
      {open === 'record' && forms.record && (
        <AnesthesiaRecordForm c={c} form={forms.record} onDone={onDone} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

/** Catatan anestesi lewat API kamar operasi (otorisasi tim kasus); validasi isian sama dengan formulir P07. */
function AnesthesiaRecordForm({
  c,
  form,
  onDone,
  onClose,
}: {
  c: SurgeryCaseView;
  form: AnesthesiaFormDef;
  onDone: Done;
  onClose: () => void;
}) {
  const { pending, run } = useAct(onDone);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      aria-label={`Isi ${form.title}`}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const errs = validateAnswers(form.schema, answers);
        setErrors(errs);
        if (Object.keys(errs).length > 0) return;
        run(() => anesthesiaRecordAction(c.id, { answers }), 'Catatan anestesi tersimpan final.', onClose);
      }}
    >
      <FormRenderer
        schema={form.schema}
        answers={answers}
        onChange={setAnswers}
        errors={errors}
        disabled={pending}
      />
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="m-0 text-caption text-danger">
          Lengkapi isian bertanda bintang.
        </p>
      )}
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>
        Simpan catatan anestesi (final)
      </Button>
    </form>
  );
}
