'use client';

import type { EncounterDiagnosis, PoliEncounter } from '@simrs/shared';
import { Alert, Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { saveCpptDraftAction, signCpptAction } from '@/app/(staf)/klinis/poli/actions';
import { icd10Display } from '@/lib/klinis';
import { SoapDiagnoses } from './soap-diagnoses';
import { SoapPlan } from './soap-plan';
import type { ScenarioTasks } from './use-scenario-tasks';

const SCENARIO_DX = 'E11.9';

function withPrimary(list: readonly Omit<EncounterDiagnosis, 'primary'>[]): EncounterDiagnosis[] {
  return list.map((d, i) => ({ ...d, primary: i === 0 }));
}

/** CPPT · SOAP dokter (mockup Main): S/O, diagnosis ICD-10, rencana, simpan draf, tanda tangan. */
export function SoapForm({
  encounter,
  canWrite,
  scenarioPatient,
  tasks,
  cpoeHref,
  kasirHref,
  onSigned,
}: {
  encounter: PoliEncounter;
  /** Posisi dokter (perawat/bidan hanya melihat). */
  canWrite: boolean;
  /** Pasien skenario Simulasi: penyimpanan lewat tugas skenario, tanda tangan akhir di CPOE. */
  scenarioPatient: boolean;
  tasks: ScenarioTasks;
  cpoeHref: string;
  kasirHref: string | null;
  onSigned: (at: string) => void;
}) {
  const e = encounter;
  const ids = useId();
  const [s, setS] = useState(e.soap.subjective);
  const [o, setO] = useState(e.soap.objective);
  const [dx, setDx] = useState<EncounterDiagnosis[]>(e.diagnoses);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(e.soap.savedAt);
  const [signedAt, setSignedAt] = useState(e.soap.signedAt);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const signed = Boolean(signedAt);
  const editable = canWrite && !signed;
  const dxTask = scenarioPatient ? tasks.task('dx') : undefined;
  const hasScenarioDx = dx.some((d) => d.code === SCENARIO_DX);
  const input = () => ({
    encounterId: e.encounterId,
    subjective: s,
    objective: o,
    diagnosisCodes: dx.map((d) => d.code),
  });
  const touch = () => setDirty(true);

  const addDx = (code: string) => {
    touch();
    setDx((cur) => withPrimary([...cur, { system: 'ICD-10', code, display: icd10Display(code) ?? code }]));
  };
  const removeDx = (code: string) => {
    touch();
    setDx((cur) => withPrimary(cur.filter((d) => d.code !== code)));
  };

  const saveDraft = () =>
    startTransition(async () => {
      const r = await saveCpptDraftAction(input());
      setMsg(r.ok ? { ok: true, text: r.message ?? '' } : { ok: false, text: r.error ?? 'Gagal menyimpan.' });
      if (r.ok && r.at) {
        setSavedAt(r.at);
        setDirty(false);
      }
    });
  const sign = () =>
    startTransition(async () => {
      const r = await signCpptAction(input());
      setMsg(
        r.ok ? { ok: true, text: r.message ?? '' } : { ok: false, text: r.error ?? 'Gagal menandatangani.' },
      );
      if (r.ok && r.at) {
        setSignedAt(r.at);
        setDirty(false);
        onSigned(r.at);
      }
    });

  let draftLabel = 'Belum ada draf';
  let draftTone = 'bg-line-strong';
  if (signed) [draftLabel, draftTone] = [`Final · ditandatangani ${signedAt}`, 'bg-success'];
  else if (dirty) [draftLabel, draftTone] = ['Perubahan belum disimpan', 'bg-warning'];
  else if (savedAt) [draftLabel, draftTone] = [`Draf tersimpan ${savedAt}`, 'bg-success'];

  const finishWhy = signed
    ? null
    : dx.length === 0
      ? 'Isi minimal satu diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan.'
      : null;
  const dxWhy =
    !dxTask || dxTask.status === 'selesai'
      ? null
      : !hasScenarioDx
        ? `Tambahkan diagnosis kerja ${SCENARIO_DX} · ${icd10Display(SCENARIO_DX)} lebih dulu.`
        : !dxTask.enabled
          ? 'Panggil pasien ke ruang periksa lebih dulu.'
          : null;
  const textArea =
    'min-h-[84px] rounded-control border border-line-strong bg-[#FCFDFD] px-3 py-2.5 font-[inherit] text-ink-900 read-only:bg-subtle';

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-4 rounded-card border border-line bg-white p-4 shadow-card md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${ids}-title`} className="m-0 text-[16px] font-semibold">
          CPPT · SOAP
        </h3>
        <span role="status" className="inline-flex items-center gap-1.5 text-caption text-ink-500">
          <span aria-hidden="true" className={cx('size-1.5 rounded-full', draftTone)} />
          {draftLabel}
        </span>
      </div>
      {!canWrite && (
        <Alert level="info">
          CPPT dokter hanya bisa diubah posisi dokter. Perawat mengisi asesmen dan tanda vital di atas.
        </Alert>
      )}
      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-s`} className="text-small font-semibold">
            S · Subjektif
          </label>
          <textarea
            id={`${ids}-s`}
            rows={3}
            value={s}
            readOnly={!editable}
            onChange={(ev) => {
              setS(ev.target.value);
              touch();
            }}
            placeholder="Keluhan utama dan riwayat singkat"
            className={textArea}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-o`} className="text-small font-semibold">
            O · Objektif
          </label>
          <textarea
            id={`${ids}-o`}
            rows={3}
            value={o}
            readOnly={!editable}
            onChange={(ev) => {
              setO(ev.target.value);
              touch();
            }}
            placeholder="Temuan pemeriksaan fisik"
            className={textArea}
          />
        </div>
      </div>
      <SoapDiagnoses
        diagnoses={dx}
        editable={editable}
        onAdd={addDx}
        onRemove={removeDx}
        showMissing={dx.length === 0 && !signed}
      />
      <SoapPlan plan={e.plan} cpoeHref={cpoeHref} tasks={tasks} />
      {signed && (
        <div
          role="status"
          className="flex flex-col gap-2.5 rounded-[12px] border border-success-border bg-[linear-gradient(90deg,#EAF6EC,#FFFFFF)] px-4 py-3.5"
        >
          <span className="font-bold text-success">✓ Kunjungan selesai · ditandatangani {signedAt}</span>
          <dl className="m-0 grid gap-2.5 text-small sm:grid-cols-3">
            {[
              ['Diagnosis utama', dx[0] ? `${dx[0].code} · ${dx[0].display}` : '—'],
              [
                'Order & resep',
                `${e.plan.filter((r) => r.kind === 'LAB' || r.kind === 'RAD').length} order penunjang · ${e.plan.filter((r) => r.kind === 'OBAT').length} resep`,
              ],
              ['Tindak lanjut', e.plan.find((r) => r.kind === 'KONTROL')?.text ?? 'Sesuai kebutuhan'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-0.5 rounded-control border border-line bg-white px-2.5 py-2"
              >
                <dt className="text-caption text-ink-500">{label}</dt>
                <dd className="m-0 font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {kasirHref && (
            <span className="flex flex-wrap items-center gap-2.5">
              <Link
                href={kasirHref}
                className="inline-flex min-h-11 items-center rounded-control border border-brand-800 bg-btn-primary px-4 font-semibold text-white no-underline"
              >
                Lanjut ke kasir
              </Link>
              <span className="text-caption text-ink-700">
                Resep terkirim ke farmasi, tagihan kunjungan siap di kasir.
              </span>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line-soft pt-2">
        <span className="text-caption text-ink-500">
          Penulis: {e.soap.author} · dibuat {e.soap.createdAt ?? '—'} ·{' '}
          {signed ? 'versi 2 (final)' : 'versi 1 (draf)'} · setiap perubahan tercatat
        </span>
        {canWrite && !scenarioPatient && (
          <span className="flex flex-wrap gap-2.5">
            <Button type="button" variant="secondary" disabled={signed || pending} onClick={saveDraft}>
              Simpan draf
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={signed || pending || dx.length === 0}
              aria-describedby={finishWhy ? `${ids}-why` : undefined}
              onClick={sign}
            >
              {signed ? 'Kunjungan selesai' : 'Tanda tangani dan selesai'}
            </Button>
          </span>
        )}
        {canWrite && dxTask && dxTask.status !== 'selesai' && (
          <Button
            variant="primary"
            type="button"
            disabled={!tasks.enabled('dx') || !hasScenarioDx}
            aria-describedby={dxWhy ? `${ids}-why` : undefined}
            onClick={() => tasks.run('dx', true)}
          >
            {dxTask.btn}
          </Button>
        )}
        {scenarioPatient && !signed && (!dxTask || dxTask.status === 'selesai') && (
          <span className="flex flex-wrap items-center gap-2 text-caption text-ink-700">
            {e.diagnoses.length > 0 ? 'SOAP dan diagnosis tersimpan. ' : ''}Resume ditandatangani di CPOE
            setelah hasil lab ditinjau.
            <Link href={cpoeHref} className="inline-flex min-h-11 items-center font-semibold">
              Buka CPOE
            </Link>
          </span>
        )}
        {(finishWhy && canWrite && !scenarioPatient) || dxWhy ? (
          <span id={`${ids}-why`} className="flex-[1_1_100%] text-right text-caption text-danger">
            {scenarioPatient ? dxWhy : finishWhy}
          </span>
        ) : null}
        {tasks.errorFor('dx') && (
          <span className="flex-[1_1_100%] text-right text-caption text-danger">{tasks.errorFor('dx')}</span>
        )}
      </div>
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={cx('m-0 text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}
