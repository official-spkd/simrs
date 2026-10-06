'use client';

import type { DoctorAppInbox } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { type FormEvent, useState } from 'react';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';

type Note = DoctorAppInbox['cosign'][number];

/**
 * Co-sign CPPT residen (mockup AppDokter): beri catatan (min. 5 karakter) atau setujui dengan TTE atas nama pengguna
 * sesi (posisi Dokter). Tersimpan di toko demo (domain `aplikasi-dokter`); CPPT yang sudah ditandatangani keluar dari
 * antrean.
 */
export function CosignCard({
  notes,
  signed,
  sentNotes,
  rev,
}: {
  notes: Note[];
  signed: Readonly<Record<string, { jam: string; by: string }>>;
  sentNotes: Readonly<Record<string, { note: string; jam: string; by: string }>>;
  rev: number;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const { act, pending, flash } = useTokoAction('aplikasi-dokter', rev);
  const waiting = notes.filter((n) => !signed[n.id]);
  const cs = waiting[0];
  const left = waiting.length;
  const last = Object.entries(signed).at(-1);
  const sentNote = cs ? sentNotes[cs.id] : undefined;
  const sent = sentNote
    ? `Catatan dikirim ke ${cs?.resident} ${sentNote.jam} oleh ${sentNote.by} · CPPT tetap menunggu tanda tangan Anda.`
    : '';
  const signedText = last
    ? `Ditandatangani (TTE) ${last[1].jam} oleh ${last[1].by} · CPPT ${notes.find((n) => n.id === last[0])?.patientName ?? ''}`
    : '';

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!cs) return;
    if (text.trim().length < 5) return setErr('Tulis catatan minimal 5 karakter.');
    act({ type: 'cosign.dicatat', noteId: cs.id, note: text.trim(), jam: demoStamp().jam }, null, () => {
      setOpen(false);
      setText('');
      setErr('');
    });
  };
  const approve = () => {
    if (!cs) return;
    act(
      {
        type: 'cosign.ditandatangani',
        noteId: cs.id,
        patientName: cs.patientName,
        rm: cs.rm,
        jam: demoStamp().jam,
      },
      null,
      () => setOpen(false),
    );
  };

  return (
    <section
      aria-label="Co-sign CPPT residen"
      className="flex flex-col gap-2.5 rounded-[16px] border border-white/95 bg-white/90 shadow-card p-3.5"
    >
      <span className="font-semibold">Co-sign CPPT residen · {left} menunggu</span>
      {signedText && (
        <span role="status" className="text-[12.5px] font-semibold text-success">
          {signedText}
        </span>
      )}
      {flash && !flash.ok && (
        <span role="status" className="text-[12.5px] font-semibold text-warning">
          {flash.text}
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
                  disabled={pending}
                  className="h-11 flex-1 cursor-pointer rounded-[12px] border border-transparent bg-btn-primary font-[inherit] font-semibold text-white shadow-button"
                >
                  Kirim catatan
                </button>
              </span>
            </form>
          ) : (
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="h-11 flex-1 cursor-pointer rounded-[12px] border border-line-strong bg-white font-[inherit] font-semibold"
              >
                Beri catatan
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={approve}
                className="h-11 flex-1 cursor-pointer rounded-[12px] border border-transparent bg-btn-primary font-[inherit] font-semibold text-white shadow-button"
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
