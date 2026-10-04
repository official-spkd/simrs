'use client';

import { type CpptEntry, formatJam, formatTanggal } from '@simrs/shared';
import { Button, cx, FilterChip } from '@simrs/ui';
import { useState, useTransition } from 'react';
import {
  CPPT_ROLE_META,
  type CpptFilter,
  correctCpptEntry,
  cpptMatches,
  newCpptEntry,
  type SoapText,
  supersededIds,
} from '@/lib/rawat-inap';
import { cosignCpptAction, saveCpptAction } from './actions';
import { CpptForm } from './cppt-form';

const FILTERS: Array<[CpptFilter, string]> = [
  ['semua', 'Semua PPA'],
  ['dokter', 'Dokter'],
  ['perawat', 'Perawat & bidan'],
  ['lainnya', 'Farmasi & gizi'],
];

/** CPPT terintegrasi (mockup Ranap): filter profesi, co-sign DPJP, tulis baru, koreksi = versi baru. */
export function CpptPanel({
  encounterId,
  entries,
  canCosign,
  sbar,
  onAdd,
  onCosign,
}: {
  encounterId: string;
  entries: CpptEntry[];
  canCosign: boolean;
  sbar: { s: string; b: string; a: string; r: string };
  onAdd: (e: CpptEntry) => void;
  onCosign: (id: string, by: string, at: string) => void;
}) {
  const [filter, setFilter] = useState<CpptFilter>('semua');
  const [form, setForm] = useState<{ mode: 'baru' } | { mode: 'koreksi'; target: CpptEntry } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSbar, setShowSbar] = useState(false);
  const [busy, start] = useTransition();
  const old = supersededIds(entries);
  const shown = [...entries]
    .filter((e) => cpptMatches(e, filter))
    .sort((a, b) => b.writtenAt.localeCompare(a.writtenAt));

  const submit = (soap: SoapText, reason: string | null) => {
    const target = form?.mode === 'koreksi' ? form.target : null;
    start(async () => {
      const r = await saveCpptAction({
        encounterId,
        s: soap.s,
        o: soap.o,
        a: soap.a,
        p: soap.p,
        supersedesId: target?.id ?? null,
        correctionReason: reason,
      });
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? 'CPPT belum tersimpan.' });
        return;
      }
      const base = { id: r.ok.id, author: r.ok.author, role: r.ok.role, at: r.ok.at, soap };
      const entry = target
        ? correctCpptEntry(entries, target.id, { ...base, reason: reason ?? '' })
        : newCpptEntry({ ...base, encounterId });
      onAdd(entry);
      setForm(null);
      if (filter !== 'semua' && !cpptMatches(entry, filter)) setFilter('semua');
      setMsg({
        ok: true,
        text: target
          ? `Koreksi tersimpan ${formatJam(r.ok.at)} sebagai versi ${entry.version}; versi lama tetap tercatat (simulasi, tidak disimpan).`
          : `CPPT baru tersimpan ${formatJam(r.ok.at)} dan ditandatangani elektronik (simulasi, tidak disimpan).`,
      });
    });
  };

  const cosign = (e: CpptEntry) =>
    start(async () => {
      const r = await cosignCpptAction({ encounterId, entryId: e.id });
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Co-sign gagal.' });
      onCosign(e.id, r.ok.by, r.ok.at);
      setMsg({
        ok: true,
        text: `CPPT residen ${formatJam(e.writtenAt)} disetujui DPJP ${formatJam(r.ok.at)} (simulasi).`,
      });
    });

  return (
    <section
      aria-label="CPPT terintegrasi"
      className="min-w-0 flex-[1_1_460px] overflow-hidden rounded-card border border-line bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-4 py-3">
        <h2 className="m-0 text-body font-semibold">CPPT terintegrasi</h2>
        <div role="group" aria-label="Filter profesi" className="flex flex-wrap gap-1.5">
          {FILTERS.map(([id, label]) => (
            <FilterChip key={id} selected={filter === id} onClick={() => setFilter(id)}>
              {label}
            </FilterChip>
          ))}
        </div>
      </div>
      {form && (
        <CpptForm
          key={form.mode === 'koreksi' ? form.target.id : 'baru'}
          title={
            form.mode === 'koreksi'
              ? `Koreksi CPPT ${formatJam(form.target.writtenAt)} · menjadi versi ${form.target.version + 1}`
              : 'CPPT baru · ditandatangani atas nama pengguna yang masuk'
          }
          initial={
            form.mode === 'koreksi'
              ? { s: form.target.s, o: form.target.o, a: form.target.a, p: form.target.p }
              : undefined
          }
          correction={form.mode === 'koreksi'}
          busy={busy}
          onSubmit={submit}
          onCancel={() => setForm(null)}
        />
      )}
      {msg && (
        <div
          role="status"
          className={cx(
            'border-b border-line-soft px-4 py-2.5 text-small font-semibold',
            msg.ok ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning',
          )}
        >
          {msg.text}
        </div>
      )}
      <ol className="m-0 list-none p-0" aria-label="Catatan CPPT">
        {shown.map((e) => (
          <CpptItem
            key={e.id}
            e={e}
            superseded={old.has(e.id)}
            canCosign={canCosign}
            busy={busy}
            onCosign={() => cosign(e)}
            onCorrect={() => setForm({ mode: 'koreksi', target: e })}
          />
        ))}
      </ol>
      {shown.length === 0 && (
        <p className="m-0 px-4 py-3.5 text-small text-ink-500">Belum ada catatan dari profesi ini.</p>
      )}
      {showSbar && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line bg-subtle px-4 py-3 text-small">
          <dt className="font-bold">S</dt>
          <dd className="m-0">{sbar.s}</dd>
          <dt className="font-bold">B</dt>
          <dd className="m-0">{sbar.b}</dd>
          <dt className="font-bold">A</dt>
          <dd className="m-0">{sbar.a}</dd>
          <dt className="font-bold">R</dt>
          <dd className="m-0">{sbar.r}</dd>
        </dl>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <Button
          variant="primary"
          aria-expanded={form?.mode === 'baru'}
          onClick={() => {
            setForm({ mode: 'baru' });
            setMsg(null);
          }}
        >
          + Tulis CPPT (SOAP)
        </Button>
        <Button aria-expanded={showSbar} onClick={() => setShowSbar((v) => !v)}>
          {showSbar ? 'Tutup ringkasan SBAR' : 'Serah terima SBAR'}
        </Button>
      </div>
    </section>
  );
}

function CpptItem({
  e,
  superseded,
  canCosign,
  busy,
  onCosign,
  onCorrect,
}: {
  e: CpptEntry;
  superseded: boolean;
  canCosign: boolean;
  busy: boolean;
  onCosign: () => void;
  onCorrect: () => void;
}) {
  const m = CPPT_ROLE_META[e.role];
  const lines = (['s', 'o', 'a', 'p'] as const).filter((k) => e[k].trim());
  const waiting = e.cosignRequired && !e.cosignedBy;
  return (
    <li className={cx('flex gap-3 border-b border-line-soft px-4 py-3', superseded && 'bg-subtle')}>
      <span
        aria-hidden="true"
        className={cx(
          'flex size-9 flex-none items-center justify-center rounded-full text-caption font-bold',
          m.tone,
        )}
      >
        {m.tag}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="font-semibold">
            {e.author} <span className="font-normal text-ink-500">· {m.label}</span>
          </span>
          <span className="text-caption text-ink-500">
            {formatTanggal(e.writtenAt)} · {formatJam(e.writtenAt)}
          </span>
        </div>
        <p
          className={cx(
            'm-0 whitespace-pre-line text-small',
            superseded ? 'text-ink-500 line-through' : 'text-ink-900',
          )}
        >
          {lines.map((k) => `${k.toUpperCase()}: ${e[k]}`).join('\n')}
        </p>
        {e.version > 1 && (
          <span className="text-caption font-semibold text-info">
            Versi {e.version} · koreksi: {e.correctionReason}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cx(
              'text-caption font-semibold',
              superseded ? 'text-ink-500' : waiting ? 'text-warning' : 'text-success',
            )}
          >
            {superseded
              ? 'Versi lama · digantikan koreksi (tetap tersimpan)'
              : waiting
                ? 'Menunggu co-sign DPJP'
                : e.cosignedBy && e.cosignedAt
                  ? `Co-sign DPJP ${e.cosignedBy} · ${formatJam(e.cosignedAt)} · TTE`
                  : `Final · TTE ${formatJam(e.writtenAt)}`}
          </span>
          {waiting && !superseded && (
            <Button
              size="sm"
              variant="primary"
              className="h-11"
              disabled={!canCosign || busy}
              aria-describedby={canCosign ? undefined : `cosign-${e.id}`}
              onClick={onCosign}
            >
              Setujui co-sign DPJP
            </Button>
          )}
          {waiting && !canCosign && (
            <span id={`cosign-${e.id}`} className="text-caption text-ink-500">
              Hanya DPJP (posisi dokter) yang dapat co-sign.
            </span>
          )}
          {!superseded && (
            <Button size="sm" variant="ghost" className="h-11" onClick={onCorrect}>
              Koreksi
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}
