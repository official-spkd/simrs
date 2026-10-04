'use client';

import { type ClinicalResult, type EwsObservation, formatJam } from '@simrs/shared';
import { cx } from '@simrs/ui';
import Link from 'next/link';
import { ewsLevel, formatTglJam } from '@/lib/rawat-inap';

const FLAG: Record<ClinicalResult['flag'], { label: string; cls: string }> = {
  normal: { label: 'Normal', cls: 'text-success' },
  tinggi: { label: 'Tinggi', cls: 'text-danger' },
  rendah: { label: 'Rendah', cls: 'text-warning' },
  kritis: { label: 'Kritis', cls: 'font-bold text-danger-strong' },
};

/** Observasi tanda vital + skor EWS dewasa (mockup Ranap). */
export function EwsPanel({ observations }: { observations: EwsObservation[] }) {
  const last = observations.at(-1);
  const lv = last ? ewsLevel(last.score) : null;
  return (
    <section
      aria-label="Observasi dan EWS"
      className="flex flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">Observasi tanda vital</h2>
        <span className="text-caption text-ink-500">EWS dewasa · rendah 0–4 · sedang 5–6 · tinggi ≥ 7</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-small">
          <caption className="sr-only">Observasi tanda vital dan skor EWS</caption>
          <thead>
            <tr className="bg-subtle text-left text-caption text-ink-700">
              {['Waktu', 'Suhu °C', 'Nadi', 'Napas', 'TD', 'SpO2', 'Oksigen', 'Kesadaran', 'EWS'].map((h) => (
                <th key={h} scope="col" className="px-2.5 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {observations.map((o) => {
              const l = ewsLevel(o.score);
              return (
                <tr key={o.at} className="border-t border-line-soft">
                  <th scope="row" className="px-2.5 py-2 text-left font-mono font-semibold">
                    {formatTglJam(o.at)}
                  </th>
                  <td className="px-2.5 py-2">{o.temp.toFixed(1).replace('.', ',')}</td>
                  <td className="px-2.5 py-2">{o.hr}</td>
                  <td className="px-2.5 py-2">{o.rr}</td>
                  <td className="px-2.5 py-2">
                    {o.sbp}/{o.dbp}
                  </td>
                  <td className="px-2.5 py-2">{o.spo2}%</td>
                  <td className="px-2.5 py-2">{o.onOxygen ? 'Ya' : 'Udara bebas'}</td>
                  <td className="px-2.5 py-2">
                    {o.consciousness === 'A' ? 'Sadar (A)' : `AVPU ${o.consciousness}`}
                  </td>
                  <td className="px-2.5 py-2">
                    <span className={cx('rounded-full px-2 py-[3px] text-caption font-bold', l.tone)}>
                      {o.score} · {l.level}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {last && lv && (
        <div className={cx('flex flex-wrap gap-2.5 rounded-control px-3.5 py-2.5 text-small', lv.tone)}>
          <span className="font-bold">
            EWS {last.score} · {lv.level}
          </span>
          <span className="text-ink-700">
            {lv.action} Observasi terakhir {formatJam(last.at)}.
          </span>
        </div>
      )}
    </section>
  );
}

/** Hasil penunjang terbaru (penanda selalu bertulisan, tidak hanya warna). */
export function ResultsPanel({ results }: { results: ClinicalResult[] }) {
  return (
    <section
      aria-label="Hasil penunjang"
      className="overflow-hidden rounded-card border border-line bg-white"
    >
      <h2 className="m-0 border-b border-line px-4 py-3 text-body font-semibold">Hasil penunjang terbaru</h2>
      <ul className="m-0 list-none p-0">
        {results.map((r) => (
          <li
            key={`${r.at}-${r.name}-${r.value}`}
            className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-0.5 border-b border-line-soft px-4 py-2.5 text-small sm:grid-cols-[130px_1fr_1.4fr_72px]"
          >
            <span className="font-mono text-caption text-ink-500">{formatTglJam(r.at)}</span>
            <span className="font-semibold">{r.name}</span>
            <span className="col-span-2 sm:col-span-1">{r.value}</span>
            <span className={cx('text-caption font-semibold', FLAG[r.flag].cls)}>{FLAG[r.flag].label}</span>
          </li>
        ))}
      </ul>
      {results.length === 0 && (
        <p className="m-0 px-4 py-3 text-small text-ink-500">Belum ada hasil penunjang.</p>
      )}
    </section>
  );
}

export interface NursingView {
  diagnosis: string;
  interventions: Array<{ id: string; label: string; done: boolean }>;
}

/** Intervensi keperawatan shift ini (centang disimpan lokal, simulasi). */
export function NursingPanel({
  problems,
  onToggle,
}: {
  problems: NursingView[];
  onToggle: (id: string) => void;
}) {
  const all = problems.flatMap((p) => p.interventions);
  const done = all.filter((i) => i.done).length;
  return (
    <section
      aria-label="Asuhan keperawatan"
      className="overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="m-0 text-body font-semibold">Intervensi keperawatan · shift ini</h2>
        <span className="text-caption font-semibold text-ink-700">
          {done}/{all.length} intervensi
        </span>
      </div>
      {problems.map((p) => {
        const d = p.interventions.filter((i) => i.done).length;
        return (
          <fieldset
            key={p.diagnosis}
            className="m-0 flex flex-col gap-0.5 border-0 border-b border-line-soft px-4 py-3"
          >
            <legend className="float-left mb-1 w-full p-0 font-semibold">
              {p.diagnosis}{' '}
              <span className="text-caption font-normal text-ink-500">
                · {d} dari {p.interventions.length} intervensi selesai
              </span>
            </legend>
            {p.interventions.map((i) => (
              <label key={i.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
                <input
                  type="checkbox"
                  checked={i.done}
                  onChange={() => onToggle(i.id)}
                  className="size-[18px] accent-brand-600"
                />
                {i.label}
              </label>
            ))}
          </fieldset>
        );
      })}
    </section>
  );
}

/** Ringkasan rawat inap + tautan ke resume dan persetujuan tindakan. */
export function SummaryPanel({
  rows,
  links,
}: {
  rows: Array<{ label: string; value: string }>;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <section
      aria-label="Ringkasan pasien"
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <h2 className="m-0 text-body font-semibold">Ringkasan rawat inap</h2>
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1.5 text-small sm:grid-cols-[180px_1fr]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-ink-500">{r.label}</dt>
            <dd className="m-0 mb-1 sm:mb-0">{r.value}</dd>
          </div>
        ))}
      </dl>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3.5 text-small font-semibold text-ink-900 no-underline"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
