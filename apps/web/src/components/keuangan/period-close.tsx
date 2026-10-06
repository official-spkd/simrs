'use client';

import { Button, cx } from '@simrs/ui';
import { useId, useRef } from 'react';
import { GatedButton } from '@/components/gated-button';

/**
 * Tutup periode fiskal (mockup Akuntansi) dengan dialog konfirmasi modal: syarat (pemetaan akun, rekonsiliasi
 * bank) tampil sebagai daftar teks; tombol tutup nonaktif dengan alasan sampai semua syarat terpenuhi.
 */
export function PeriodClose({
  periodLabel,
  prereqs,
  ready,
  reason,
  pending,
  onConfirm,
}: {
  periodLabel: string;
  prereqs: ReadonlyArray<{ ok: boolean; text: string }>;
  ready: boolean;
  reason: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const month = periodLabel.split(' ')[0] ?? periodLabel;
  return (
    <>
      <Button aria-haspopup="dialog" onClick={() => ref.current?.showModal()}>
        Tutup periode {month}
      </Button>
      <dialog
        ref={ref}
        role="alertdialog"
        aria-labelledby={`${id}-judul`}
        aria-describedby={`${id}-isi`}
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-card border border-warning-border p-0 text-ink-900 backdrop:bg-[rgba(20,33,43,0.45)]"
      >
        <div className="flex flex-col gap-3 bg-[linear-gradient(100deg,rgba(138,75,0,0.08),var(--color-kunyit-50)_60%)] p-5">
          <h2 id={`${id}-judul`} className="m-0 text-h2 font-semibold">
            Tutup periode {periodLabel}?
          </h2>
          <p id={`${id}-isi`} className="m-0 text-small text-ink-700">
            Semua jurnal periode ini akan dikunci. Koreksi setelahnya hanya lewat jurnal balik di periode
            berikut; membuka ulang butuh persetujuan direktur keuangan.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {prereqs.map((p) => (
              <li key={p.text} className="flex gap-2 text-small">
                <span aria-hidden="true" className={cx('font-bold', p.ok ? 'text-success' : 'text-warning')}>
                  {p.ok ? '✓' : '!'}
                </span>
                <span className="text-ink-700">
                  <span className="sr-only">{p.ok ? 'Terpenuhi: ' : 'Belum terpenuhi: '}</span>
                  {p.text}
                </span>
              </li>
            ))}
          </ul>
          <span className="flex flex-wrap items-center gap-2">
            <Button onClick={() => ref.current?.close()}>Batal</Button>
            <GatedButton
              variant="primary"
              enabled={ready && !pending}
              aria-describedby={!ready && reason ? `${id}-alasan` : undefined}
              onClick={() => {
                onConfirm();
                ref.current?.close();
              }}
            >
              Ya, tutup dan kunci periode
            </GatedButton>
          </span>
          {!ready && reason && (
            <span id={`${id}-alasan`} className="text-small font-medium text-warning">
              {reason}
            </span>
          )}
        </div>
      </dialog>
    </>
  );
}
