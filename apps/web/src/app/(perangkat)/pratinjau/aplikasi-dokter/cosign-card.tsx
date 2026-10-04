'use client';

import { type DoctorAppInbox, formatJam } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type FormEvent, useState } from 'react';

type Note = DoctorAppInbox['cosign'][number];

/**
 * Co-sign CPPT residen (mockup AppDokter): beri catatan (min. 5 karakter) atau setujui dengan TTE. Di mode
 * presentasi tanda tangan dan catatan hanya berlaku di layar ini (simulasi, tidak disimpan).
 */
export function CosignCard({
  notes,
  index,
  onSigned,
}: {
  notes: Note[];
  index: number;
  onSigned: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');
  const [signed, setSigned] = useState('');
  const cs = notes[index];
  const left = notes.length - index;

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!cs) return;
    if (text.trim().length < 5) return setErr('Tulis catatan minimal 5 karakter.');
    setSent(
      `Catatan dikirim ke ${cs.resident} ${formatJam(new Date())} · CPPT tetap menunggu tanda tangan Anda (simulasi, tidak disimpan).`,
    );
    setOpen(false);
    setText('');
    setErr('');
  };
  const approve = () => {
    if (!cs) return;
    const msg = `Ditandatangani (TTE) ${formatJam(new Date())} · CPPT ${cs.patientName} (simulasi, tidak disimpan)`;
    setSigned(msg);
    setSent('');
    setOpen(false);
    onSigned(msg);
  };

  return (
    <section
      aria-label="Co-sign CPPT residen"
      className="flex flex-col gap-2.5 rounded-[16px] border border-line bg-white p-3.5"
    >
      <span className="font-semibold">Co-sign CPPT residen · {left} menunggu</span>
      {signed && (
        <span role="status" className="text-[12.5px] font-semibold text-success">
          {signed}
        </span>
      )}
      {cs ? (
        <>
          <span className="text-[12.5px] text-ink-500">
            {cs.resident} · {cs.patientName} · RM {cs.rm} · SOAP {cs.time}
          </span>
          <span className="text-[13.5px] text-ink-900">{cs.soap}</span>
          {sent && (
            <span role="status" className="text-[12.5px] text-brand-700">
              {sent}
            </span>
          )}
          {open ? (
            <form onSubmit={send} className="flex flex-col gap-1.5">
              <label htmlFor="catatan-residen" className="text-[13px] font-semibold">
                Catatan untuk residen
              </label>
              <textarea
                id="catatan-residen"
                rows={3}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setErr('');
                }}
                aria-invalid={err ? true : undefined}
                aria-describedby="catatan-pesan"
                placeholder="mis. Tambahkan target GDS sebelum pulang"
                className={cx(
                  'rounded-[12px] border px-3 py-2 font-[inherit]',
                  err ? 'border-danger' : 'border-line-strong',
                )}
              />
              <span id="catatan-pesan" className={cx('text-[12px]', err ? 'text-danger' : 'text-ink-500')}>
                {err || 'Catatan masuk ke CPPT sebagai umpan balik untuk residen.'}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setErr('');
                  }}
                  className="h-11 flex-1 cursor-pointer rounded-[12px] border border-line-strong bg-white font-[inherit]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="h-11 flex-1 cursor-pointer rounded-[12px] border border-brand-800 bg-brand-600 font-[inherit] font-semibold text-white"
                >
                  Kirim catatan
                </button>
              </span>
            </form>
          ) : (
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  setSent('');
                }}
                className="h-11 flex-1 cursor-pointer rounded-[12px] border border-line-strong bg-white font-[inherit] font-semibold"
              >
                Beri catatan
              </button>
              <button
                type="button"
                onClick={approve}
                className="h-11 flex-1 cursor-pointer rounded-[12px] border border-brand-800 bg-brand-600 font-[inherit] font-semibold text-white"
              >
                Setujui (TTE)
              </button>
            </span>
          )}
        </>
      ) : (
        <span className="text-[13px] text-ink-500">Tidak ada CPPT residen yang menunggu tanda tangan.</span>
      )}
    </section>
  );
}
