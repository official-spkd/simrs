'use client';

import { formatJam } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { saveEducationAction } from '@/app/(staf)/klinis/edukasi/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { at as wibAt } from '@/lib/demo/fixtures/rawat-inap';
import { formatTglJam } from '@/lib/rawat-inap';
import {
  consentReady,
  EDU_METHODS,
  EDU_TOPICS,
  type EduDraft,
  eduBlocker,
  type EduMethod,
  type EduRecord,
  type EduTopic,
  EMPTY_EDU,
  professionOf,
  RECIPIENT_LABEL,
  type Recipient,
  topicCoverage,
  UNDERSTANDING_LABEL,
  type Understanding,
} from '@/lib/rme-edukasi';
import { Feedback, type FeedbackMsg } from './feedback';

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';
const CARD = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5';
const CHECK =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-small has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50';

const toggle = <T,>(list: readonly T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/**
 * K11 · Edukasi pasien dan keluarga terintegrasi: materi wajib per kunjungan, metode, sasaran, verifikasi pemahaman
 * teach-back (belum paham → jadwal edukasi ulang), tanda tangan penerima (ketik nama) + atestasi edukator. Edukasi
 * tindakan yang terverifikasi paham membuka persetujuan tindakan. Catatan diperiksa dan disimpan server (toko demo
 * `rekam-medis`) atas nama pengguna sesi; daftar catatan datang dari server.
 */
export function EdukasiWorkspace({
  encounterId,
  role,
  user,
  canEducate,
  required,
  records,
  rev,
  defaultRecipient,
  consentHref,
}: {
  encounterId: string;
  role: string | null;
  user: string;
  canEducate: boolean;
  required: readonly EduTopic[];
  records: readonly EduRecord[];
  /** Revisi toko `rekam-medis`. */
  rev: number;
  defaultRecipient: string;
  /** Tautan tablet persetujuan tindakan pasien ini, null bila tidak ada dokumen. */
  consentHref: string | null;
}) {
  const id = useId();
  const { run, pending } = useStoreAction(rev);
  const [d, setD] = useState<EduDraft>({ ...EMPTY_EDU, recipientName: defaultRecipient });
  const [repeatHm, setRepeatHm] = useState('');
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const draft: EduDraft = { ...d, repeatAt: repeatHm ? wibAt(DEMO_TODAY, repeatHm.replace(':', '.')) : '' };
  const block = eduBlocker(draft);
  const cov = topicCoverage(records, required);
  const needsConsent = required.includes('tindakan');
  const ready = consentReady(records);

  const save = () => {
    setTried(true);
    if (block || !draft.understanding) return;
    run(
      (r) => saveEducationAction({ encounterId, ...draft }, r),
      (res) => {
        setMsg({ ok: res.ok, text: res.message });
        if (!res.ok) return;
        setD({ ...EMPTY_EDU, recipientName: defaultRecipient });
        setRepeatHm('');
        setTried(false);
      },
    );
  };

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label="Catat edukasi" className={cx(CARD, 'flex-[2_1_520px]')}>
        <h2 className="m-0 text-body font-semibold">Catat edukasi · {professionOf(role)}</h2>
        <Feedback msg={msg} />
        {!canEducate ? (
          <p className="m-0 text-small text-ink-500">Edukasi dicatat oleh PPA (dokter, perawat, bidan).</p>
        ) : (
          <form
            aria-label="Formulir edukasi"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 p-0 text-small font-semibold">1. Materi</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(EDU_TOPICS) as EduTopic[]).map((t) => (
                  <label key={t} className={cx(CHECK, 'border-line-strong bg-white')}>
                    <input
                      type="checkbox"
                      checked={d.topics.includes(t)}
                      onChange={() => setD({ ...d, topics: toggle(d.topics, t) })}
                      className="size-4 accent-brand-600"
                    />
                    {EDU_TOPICS[t]}
                    {required.includes(t) && (
                      <span className="text-caption font-semibold text-brand-700">wajib</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 p-0 text-small font-semibold">2. Metode</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(EDU_METHODS) as EduMethod[]).map((m) => (
                  <label key={m} className={cx(CHECK, 'border-line-strong bg-white')}>
                    <input
                      type="checkbox"
                      checked={d.methods.includes(m)}
                      onChange={() => setD({ ...d, methods: toggle(d.methods, m) })}
                      className="size-4 accent-brand-600"
                    />
                    {EDU_METHODS[m]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-[1_1_180px] flex-col gap-1">
                <label htmlFor={`${id}-sasaran`} className="text-small font-semibold">
                  3. Sasaran
                </label>
                <select
                  id={`${id}-sasaran`}
                  value={d.recipient}
                  onChange={(e) => setD({ ...d, recipient: e.target.value as Recipient })}
                  className={INPUT}
                >
                  {(Object.keys(RECIPIENT_LABEL) as Recipient[]).map((r) => (
                    <option key={r} value={r}>
                      {RECIPIENT_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 flex-[2_1_220px] flex-col gap-1">
                <label htmlFor={`${id}-nama`} className="text-small font-semibold">
                  Nama penerima
                </label>
                <input
                  id={`${id}-nama`}
                  value={d.recipientName}
                  onChange={(e) => setD({ ...d, recipientName: e.target.value })}
                  className={INPUT}
                />
              </div>
            </div>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 p-0 text-small font-semibold">
                4. Verifikasi pemahaman (teach-back)
              </legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(UNDERSTANDING_LABEL) as Understanding[]).map((u) => (
                  <label key={u} className={cx(CHECK, 'border-line-strong bg-white')}>
                    <input
                      type="radio"
                      name={`${id}-paham`}
                      checked={d.understanding === u}
                      onChange={() => setD({ ...d, understanding: u })}
                      className="size-4 accent-brand-600"
                    />
                    {UNDERSTANDING_LABEL[u]}
                  </label>
                ))}
              </div>
              {d.understanding === 'paham' && (
                <>
                  <label htmlFor={`${id}-tb`} className="text-small font-semibold">
                    Ucapan ulang penerima
                  </label>
                  <textarea
                    id={`${id}-tb`}
                    rows={2}
                    value={d.teachBack}
                    onChange={(e) => setD({ ...d, teachBack: e.target.value })}
                    className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit]"
                  />
                </>
              )}
              {(d.understanding === 'perlu-diulang' || d.understanding === 'tidak-paham') && (
                <>
                  <label htmlFor={`${id}-ulang`} className="text-small font-semibold">
                    Jadwal edukasi ulang hari ini
                  </label>
                  <input
                    id={`${id}-ulang`}
                    type="time"
                    value={repeatHm}
                    onChange={(e) => setRepeatHm(e.target.value)}
                    className={cx(INPUT, 'w-40')}
                  />
                </>
              )}
            </fieldset>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-ttd`} className="text-small font-semibold">
                5. Tanda tangan penerima (ketik nama penerima)
              </label>
              <input
                id={`${id}-ttd`}
                value={d.signature}
                onChange={(e) => setD({ ...d, signature: e.target.value })}
                className={INPUT}
              />
            </div>
            <label className="flex min-h-11 items-start gap-2 text-small">
              <input
                type="checkbox"
                checked={d.attested}
                onChange={(e) => setD({ ...d, attested: e.target.checked })}
                className="mt-1 size-4 accent-brand-600"
              />
              Saya, {user}, memberikan edukasi ini dan memverifikasi pemahaman penerima.
            </label>
            {tried && block && (
              <p role="alert" className="m-0 text-small font-semibold text-danger">
                {block}
              </p>
            )}
            <Button type="submit" variant="primary" className="self-start" disabled={pending}>
              Simpan edukasi (final)
            </Button>
          </form>
        )}
      </section>

      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <section aria-label="Kebutuhan edukasi" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Kebutuhan edukasi kunjungan ini</h2>
          <span className="text-caption text-ink-500">
            {cov.paham.length} dari {required.length} materi wajib terverifikasi paham
          </span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {required.map((t) => {
              const st = cov.paham.includes(t) ? 'paham' : cov.ulang.includes(t) ? 'ulang' : 'belum';
              return (
                <li key={t} className="flex items-center justify-between gap-2 text-small">
                  <span>{EDU_TOPICS[t]}</span>
                  <Chip tone={st === 'paham' ? 'success' : st === 'ulang' ? 'warning' : 'neutral'}>
                    {st === 'paham' ? '✓ Paham' : st === 'ulang' ? 'Perlu diulang' : 'Belum'}
                  </Chip>
                </li>
              );
            })}
          </ul>
          {needsConsent && (
            <p
              role="status"
              className={cx(
                'm-0 rounded-control border px-3 py-2 text-small font-semibold',
                ready
                  ? 'border-success-border bg-success-bg text-success'
                  : 'border-warning-border bg-warning-bg text-warning',
              )}
            >
              {ready
                ? 'Persetujuan tindakan siap: edukasi tindakan terverifikasi paham.'
                : 'Persetujuan tindakan belum siap: edukasi tindakan belum terverifikasi paham.'}
              {ready && consentHref && (
                <>
                  {' '}
                  <Link href={consentHref}>Buka persetujuan di tablet</Link>
                </>
              )}
            </p>
          )}
        </section>
        <section aria-label="Riwayat edukasi" className={CARD}>
          <h2 className="m-0 text-body font-semibold">Riwayat edukasi terintegrasi</h2>
          {records.length === 0 && <p className="m-0 text-small text-ink-500">Belum ada edukasi tercatat.</p>}
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {[...records]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-0.5 rounded-control border border-line px-3 py-2 text-small"
                >
                  <span className="font-semibold">{r.topics.map((t) => EDU_TOPICS[t]).join(' · ')}</span>
                  <span className="text-caption text-ink-700">
                    {r.educator} ({r.profession}) → {r.recipientName} · {formatTglJam(r.at)} ·{' '}
                    {r.methods.map((m) => EDU_METHODS[m]).join(', ')}
                  </span>
                  <span
                    className={cx(
                      'text-caption font-semibold',
                      r.understanding === 'paham' ? 'text-success' : 'text-warning',
                    )}
                  >
                    {UNDERSTANDING_LABEL[r.understanding]}
                    {r.repeatAt ? ` · edukasi ulang ${formatJam(r.repeatAt)}` : ''}
                  </span>
                  {r.teachBack && <span className="text-caption italic">“{r.teachBack}”</span>}
                  <span className="text-caption text-ink-500">Ditandatangani penerima: {r.signature}</span>
                </li>
              ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
