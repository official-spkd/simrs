'use client';

import { formatJam } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { type Handover, handoverBlocker, handoverStatus, type Sbar } from '@/lib/rme-cppt';
import { Feedback, type FeedbackMsg } from './feedback';

const PARTS: Array<{ k: keyof Sbar; label: string }> = [
  { k: 's', label: 'S · Situasi' },
  { k: 'b', label: 'B · Latar belakang' },
  { k: 'a', label: 'A · Penilaian' },
  { k: 'r', label: 'R · Rekomendasi' },
];

/**
 * K07 · Serah terima antarshift dengan SBAR: draf terisi dari rekam (bisa disunting), pilih penerima, serahkan, lalu
 * penerima mengonfirmasi (tercatat berjam). Tidak dianggap selesai sebelum diterima.
 */
export function HandoverPanel({
  encounterId,
  user,
  shift,
  previous,
  receivers,
  draft,
}: {
  encounterId: string;
  user: string;
  shift: string;
  previous: readonly Handover[];
  receivers: readonly string[];
  draft: Sbar;
}) {
  const id = useId();
  const [sbar, setSbar] = useState<Sbar>(draft);
  const [receiver, setReceiver] = useState('');
  const [tried, setTried] = useState(false);
  const [current, setCurrent] = useState<Handover | null>(null);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const blocker = handoverBlocker(sbar, receiver, user);

  return (
    <section
      aria-label="Serah terima SBAR"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 self-start rounded-card border border-line bg-white px-4 py-3.5"
    >
      <div className="flex flex-col">
        <h2 className="m-0 text-body font-semibold">Serah terima SBAR</h2>
        <span className="text-caption text-ink-500">Shift {shift}</span>
      </div>
      {previous.map((h) => (
        <div key={h.id} className="flex flex-col gap-0.5 rounded-control bg-subtle px-3 py-2 text-small">
          <span className="font-semibold">
            {h.shift} · diserahkan {h.giver} · {formatJam(h.givenAt)}
          </span>
          <span className={cx('font-semibold', h.acceptedAt ? 'text-success' : 'text-warning')}>
            {handoverStatus(h)}
          </span>
        </div>
      ))}
      <Feedback msg={msg} />
      {current ? (
        <div className="flex flex-col gap-2 rounded-control border border-line px-3 py-2.5 text-small">
          <span className="font-semibold">
            Diserahkan {formatJam(current.givenAt)} kepada {current.receiver}
          </span>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {PARTS.map((p) => (
              <div key={p.k} className="contents">
                <dt className="font-bold">{p.k.toUpperCase()}</dt>
                <dd className="m-0">{current.sbar[p.k]}</dd>
              </div>
            ))}
          </dl>
          <span className={cx('font-semibold', current.acceptedAt ? 'text-success' : 'text-warning')}>
            {handoverStatus(current)}
          </span>
          {!current.acceptedAt && (
            <Button
              variant="primary"
              onClick={() => {
                const at = demoNow().toISOString();
                setCurrent({ ...current, acceptedAt: at });
                setMsg({
                  ok: true,
                  text: `Serah terima diterima ${current.receiver} · ${formatJam(at)} (simulasi, tidak disimpan).`,
                });
              }}
            >
              Konfirmasi penerimaan (simulasi penerima)
            </Button>
          )}
        </div>
      ) : (
        <form
          aria-label="Serahkan shift"
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (blocker) return;
            const at = demoNow().toISOString();
            setCurrent({
              id: `${encounterId}-sbar-baru`,
              shift,
              giver: user,
              receiver,
              sbar,
              givenAt: at,
              acceptedAt: null,
            });
            setMsg({
              ok: true,
              text: `Diserahkan · ${formatJam(at)} · menunggu konfirmasi ${receiver} (simulasi, tidak disimpan).`,
            });
          }}
        >
          {PARTS.map((p) => (
            <div key={p.k} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${p.k}`} className="text-small font-semibold">
                {p.label} <span className="text-danger">*</span>
              </label>
              <textarea
                id={`${id}-${p.k}`}
                rows={2}
                value={sbar[p.k]}
                maxLength={600}
                onChange={(e) => setSbar((cur) => ({ ...cur, [p.k]: e.target.value }))}
                className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-penerima`} className="text-small font-semibold">
              Penerima shift berikutnya <span className="text-danger">*</span>
            </label>
            <select
              id={`${id}-penerima`}
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              <option value="">Pilih penerima…</option>
              {receivers.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {tried && blocker && (
            <p role="alert" className="m-0 text-small font-semibold text-danger">
              {blocker}
            </p>
          )}
          <Button type="submit" variant="primary">
            Serahkan shift
          </Button>
        </form>
      )}
    </section>
  );
}
