'use client';

import { SAFETY_REASON_MIN } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import type { SoapText } from '@/lib/rawat-inap';

const FIELDS: Array<{ k: keyof SoapText; label: string; ph: string; required: boolean }> = [
  { k: 's', label: 'S · Subjektif', ph: 'Keluhan pasien', required: true },
  { k: 'o', label: 'O · Objektif', ph: 'Tanda vital, temuan', required: false },
  { k: 'a', label: 'A · Asesmen', ph: 'Masalah klinis / keperawatan', required: true },
  { k: 'p', label: 'P · Rencana', ph: 'Intervensi dan tindak lanjut', required: false },
];

const FORM_LABEL = { baru: 'Tulis CPPT baru', koreksi: 'Koreksi CPPT', addendum: 'Addendum CPPT' } as const;
const SUBMIT_LABEL = {
  baru: 'Simpan dan tanda tangani',
  koreksi: 'Simpan koreksi (versi baru)',
  addendum: 'Simpan addendum',
} as const;

/**
 * Formulir CPPT (SOAP). Koreksi (hanya penulis): isi lama sebagai awal + alasan koreksi wajib; disimpan sebagai
 * versi baru, entri lama tidak berubah (CLAUDE.md §4.2). Addendum (PPA lain): catatan baru yang menunjuk entri itu.
 */
export function CpptForm({
  title,
  initial,
  mode,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: SoapText;
  mode: 'baru' | 'koreksi' | 'addendum';
  busy: boolean;
  onSubmit: (soap: SoapText, reason: string | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const correction = mode === 'koreksi';
  const [f, setF] = useState<SoapText>(initial ?? { s: '', o: '', a: '', p: '' });
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const err = (k: keyof SoapText) =>
    tried && FIELDS.find((x) => x.k === k)?.required && !f[k].trim() ? `${k.toUpperCase()} wajib diisi.` : '';
  const reasonErr =
    tried && correction && reason.trim().length < SAFETY_REASON_MIN
      ? `Alasan koreksi wajib (minimal ${SAFETY_REASON_MIN} karakter).`
      : '';
  return (
    <form
      aria-label={FORM_LABEL[mode]}
      className="flex flex-col gap-2.5 border-b border-line bg-brand-50 px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        const ok = f.s.trim() && f.a.trim() && (!correction || reason.trim().length >= SAFETY_REASON_MIN);
        if (ok) onSubmit(f, correction ? reason.trim() : null);
      }}
    >
      <span className="text-caption font-semibold text-brand-700">{title}</span>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {FIELDS.map((x) => (
          <div key={x.k} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${x.k}`} className="text-small font-semibold">
              {x.label}
              {x.required && <span className="text-danger"> *</span>}
            </label>
            <textarea
              id={`${id}-${x.k}`}
              rows={2}
              value={f[x.k]}
              placeholder={x.ph}
              maxLength={1000}
              aria-invalid={!!err(x.k)}
              aria-describedby={err(x.k) ? `${id}-${x.k}-err` : undefined}
              onChange={(e) => setF((cur) => ({ ...cur, [x.k]: e.target.value }))}
              className={cx(
                'rounded-control border bg-white px-3 py-2 font-[inherit]',
                err(x.k) ? 'border-danger' : 'border-line-strong',
              )}
            />
            {err(x.k) && (
              <span id={`${id}-${x.k}-err`} className="text-caption text-danger">
                {err(x.k)}
              </span>
            )}
          </div>
        ))}
      </div>
      {correction && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-alasan`} className="text-small font-semibold">
            Alasan koreksi <span className="text-danger">*</span>
          </label>
          <textarea
            id={`${id}-alasan`}
            rows={2}
            value={reason}
            maxLength={500}
            aria-invalid={!!reasonErr}
            aria-describedby={`${id}-alasan-info`}
            onChange={(e) => setReason(e.target.value)}
            className={cx(
              'rounded-control border bg-white px-3 py-2 font-[inherit]',
              reasonErr ? 'border-danger' : 'border-line-strong',
            )}
          />
          <span
            id={`${id}-alasan-info`}
            className={cx('text-caption', reasonErr ? 'text-danger' : 'text-ink-500')}
          >
            {reasonErr ||
              'Entri lama tidak diubah; koreksi disimpan sebagai versi baru dan tercatat di jejak audit.'}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {SUBMIT_LABEL[mode]}
        </Button>
        <Button onClick={onCancel}>Batal</Button>
      </div>
    </form>
  );
}
