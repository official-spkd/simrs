'use client';

import {
  type FluidBalanceDay,
  formatJam,
  formatTanggalLahir,
  type NursingCarePlanRecord,
  type NursingDiagnosisOption,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { formatTglJam } from '@/lib/rawat-inap';
import { carePlanAction, fluidAction } from './actions-api';
import type { Me, Perms } from './api-workspace';

type Msg = { ok: boolean; text: string } | null;

const ml = (n: number) => `${n.toLocaleString('id-ID')} mL`;

/**
 * Asuhan keperawatan mode api (K12): rencana asuhan berversi per diagnosis keperawatan (master lokal RS, keputusan
 * fase 3 no. 15) dan balans cairan harian (observasi kategori `cairan`). Pembaruan evaluasi = versi baru beralasan.
 */
export function ApiCareTab({
  encounterId,
  plans,
  diagnoses,
  fluids,
  me,
  perms,
}: {
  encounterId: string;
  plans: NursingCarePlanRecord[];
  diagnoses: NursingDiagnosisOption[];
  fluids: FluidBalanceDay;
  me: Me;
  perms: Perms;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<NursingCarePlanRecord | 'baru' | null>(null);
  const done = (text: string) => {
    setEditing(null);
    setMsg({ ok: true, text });
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Rencana asuhan keperawatan"
        className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="m-0 text-body font-semibold">Rencana asuhan keperawatan</h2>
          {perms.write && (
            <Button
              size="sm"
              variant="primary"
              aria-expanded={editing === 'baru'}
              onClick={() => setEditing('baru')}
            >
              + Rencana asuhan baru
            </Button>
          )}
        </div>
        {msg && (
          <p
            role={msg.ok ? 'status' : 'alert'}
            className={cx(
              'm-0 border-b border-line-soft px-4 py-2 text-small font-semibold',
              msg.ok ? 'text-success' : 'text-danger',
            )}
          >
            {msg.text}
          </p>
        )}
        {editing && (
          <CarePlanForm
            key={editing === 'baru' ? 'baru' : editing.id}
            encounterId={encounterId}
            diagnoses={diagnoses}
            target={editing === 'baru' ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={done}
          />
        )}
        <ul className="m-0 list-none p-0">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 border-b border-line-soft px-4 py-3 text-small">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{p.diagnosis}</span>
                <span className="text-caption text-ink-500">
                  {formatTglJam(p.occurredAt)} · {p.author.nama}
                  {p.version > 1 ? ` · versi ${p.version}` : ''}
                </span>
              </span>
              <span>
                <span className="text-ink-500">Tujuan:</span> {p.goals}
              </span>
              <ul className="m-0 list-disc pl-5">
                {p.interventions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <span>
                <span className="text-ink-500">Evaluasi:</span> {p.evaluation ?? 'belum dievaluasi'}
              </span>
              {p.correctionReason && (
                <span className="text-caption font-semibold text-info">Pembaruan: {p.correctionReason}</span>
              )}
              {perms.write && perms.correct && p.author.userId === me.id && (
                <span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                    Perbarui evaluasi
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {plans.length === 0 && (
          <p className="m-0 px-4 py-3 text-small text-ink-500">Belum ada rencana asuhan keperawatan.</p>
        )}
      </section>
      <FluidBalance encounterId={encounterId} fluids={fluids} canWrite={perms.write} />
    </div>
  );
}

function CarePlanForm({
  encounterId,
  diagnoses,
  target,
  onCancel,
  onDone,
}: {
  encounterId: string;
  diagnoses: NursingDiagnosisOption[];
  /** Null = rencana baru; selain itu pembaruan rencana itu (versi baru). */
  target: NursingCarePlanRecord | null;
  onCancel: () => void;
  onDone: (text: string) => void;
}) {
  const id = useId();
  const [diagnosisId, setDiagnosisId] = useState(target?.diagnosisId ?? diagnoses[0]?.id ?? '');
  const [goals, setGoals] = useState(target?.goals ?? '');
  const [interventions, setInterventions] = useState(target?.interventions.join('\n') ?? '');
  const [evaluation, setEvaluation] = useState(target?.evaluation ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const field = 'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]';
  return (
    <form
      aria-label={target ? 'Perbarui rencana asuhan' : 'Rencana asuhan baru'}
      className="flex flex-col gap-2.5 border-b border-line bg-card-header px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (target && reason.trim().length < SAFETY_REASON_MIN) {
          setError(`Alasan pembaruan wajib (minimal ${SAFETY_REASON_MIN} karakter).`);
          return;
        }
        start(async () => {
          const r = await carePlanAction({
            encounterId,
            diagnosisId,
            goals,
            interventions: interventions
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
            evaluation,
            supersedesId: target?.id ?? null,
            correctionReason: target ? reason.trim() : null,
          });
          if (!r.ok) return setError(r.message);
          onDone(
            target
              ? `Rencana asuhan diperbarui (versi ${r.data.version}); versi lama tetap tersimpan.`
              : 'Rencana asuhan keperawatan tersimpan.',
          );
        });
      }}
    >
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-dx`} className="text-small font-semibold">
            Diagnosis keperawatan
          </label>
          <select
            id={`${id}-dx`}
            value={diagnosisId}
            disabled={!!target}
            onChange={(e) => setDiagnosisId(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            {diagnoses.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-tujuan`} className="text-small font-semibold">
            Tujuan <span className="text-danger">*</span>
          </label>
          <textarea
            id={`${id}-tujuan`}
            rows={2}
            required
            maxLength={2000}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            className={field}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-intervensi`} className="text-small font-semibold">
            Intervensi (satu per baris) <span className="text-danger">*</span>
          </label>
          <textarea
            id={`${id}-intervensi`}
            rows={3}
            required
            value={interventions}
            onChange={(e) => setInterventions(e.target.value)}
            className={field}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-evaluasi`} className="text-small font-semibold">
            Evaluasi
          </label>
          <textarea
            id={`${id}-evaluasi`}
            rows={3}
            maxLength={2000}
            value={evaluation}
            onChange={(e) => setEvaluation(e.target.value)}
            className={field}
          />
        </span>
        {target && (
          <span className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
              Alasan pembaruan <span className="text-danger">*</span>
            </label>
            <input
              id={`${id}-alasan`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            />
          </span>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || diagnoses.length === 0}>
          {target ? 'Simpan pembaruan (versi baru)' : 'Simpan rencana asuhan'}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Batal
        </Button>
        {diagnoses.length === 0 && (
          <span className="text-caption text-ink-700">Master diagnosis keperawatan RS belum diisi.</span>
        )}
        {error && (
          <span role="alert" className="text-small font-semibold text-danger">
            {error}
          </span>
        )}
      </span>
    </form>
  );
}

/** Balans cairan hari ini: ringkasan masuk/keluar + catatan baru. */
function FluidBalance({
  encounterId,
  fluids,
  canWrite,
}: {
  encounterId: string;
  fluids: FluidBalanceDay;
  canWrite: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [direction, setDirection] = useState<'intake' | 'output'>('intake');
  const [route, setRoute] = useState('');
  const [volume, setVolume] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, start] = useTransition();
  return (
    <section
      aria-label="Balans cairan"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">Balans cairan · {formatTanggalLahir(fluids.date)}</h2>
        <span className="text-small">
          Masuk {ml(fluids.intakeMl)} · keluar {ml(fluids.outputMl)} ·{' '}
          <span className="font-semibold">
            balans {fluids.balanceMl >= 0 ? '+' : ''}
            {ml(fluids.balanceMl)}
          </span>
        </span>
      </div>
      {fluids.entries.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
          {fluids.entries.map((e) => (
            <li key={e.id}>
              <span className="font-mono font-semibold">{formatJam(e.occurredAt)}</span> ·{' '}
              {e.direction === 'intake' ? 'Masuk' : 'Keluar'} {ml(e.volumeMl)} · {e.route}
              <span className="text-ink-500">
                {' '}
                · {e.author.nama}
                {e.note ? ` · ${e.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          aria-label="Catat cairan"
          className="flex flex-wrap items-end gap-2.5 border-t border-line-soft pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await fluidAction({ encounterId, direction, route, volumeMl: volume, note });
              if (!r.ok) return setMsg({ ok: false, text: r.message });
              setRoute('');
              setVolume('');
              setNote('');
              setMsg({ ok: true, text: 'Catatan cairan tersimpan.' });
              router.refresh();
            });
          }}
        >
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-arah`} className="text-small font-semibold">
              Arah
            </label>
            <select
              id={`${id}-arah`}
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'intake' | 'output')}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              <option value="intake">Masuk</option>
              <option value="output">Keluar</option>
            </select>
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-jalur`} className="text-small font-semibold">
              Jalur
            </label>
            <input
              id={`${id}-jalur`}
              value={route}
              maxLength={120}
              placeholder="Infus, oral, urin, drain"
              onChange={(e) => setRoute(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            />
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-vol`} className="text-small font-semibold">
              Volume (mL)
            </label>
            <input
              id={`${id}-vol`}
              value={volume}
              inputMode="numeric"
              onChange={(e) => setVolume(e.target.value)}
              className="h-11 w-28 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            />
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor={`${id}-cat`} className="text-small font-semibold">
              Catatan
            </label>
            <input
              id={`${id}-cat`}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            />
          </span>
          <Button type="submit" variant="primary" disabled={busy || !route.trim() || !volume.trim()}>
            Simpan cairan
          </Button>
          {msg && (
            <span
              role={msg.ok ? 'status' : 'alert'}
              className={cx('text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
            >
              {msg.text}
            </span>
          )}
        </form>
      )}
    </section>
  );
}
