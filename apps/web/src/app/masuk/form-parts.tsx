'use client';

import { Button, cx } from '@simrs/ui';
import { type ClipboardEvent, type KeyboardEvent, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

/** Tombol kirim yang nonaktif dan memberi tahu selama action berjalan (mencegah kirim ganda). */
export function SubmitButton({ children, pending: pendingLabel }: { children: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={pending}
      aria-disabled={pending}
      className="h-12 w-full"
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Pesan galat formulir yang langsung dibacakan pembaca layar. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="m-0 rounded-control border border-danger-border bg-danger-bg px-3.5 py-2.5 text-small text-danger"
    >
      {message}
    </p>
  );
}

/**
 * Enam kotak kode verifikasi (mockup Login): ketik maju otomatis, Backspace mundur, tempel 6 digit sekaligus.
 * Nilai gabungan dikirim lewat input tersembunyi `name` (bawaan `code`). `masked` untuk PIN: angka disamarkan dan
 * tidak ditawarkan isi otomatis.
 */
export function OtpInput({
  error,
  label = 'Kode verifikasi',
  name = 'code',
  masked = false,
  digitLabel = 'Digit',
}: {
  error?: string;
  label?: string;
  name?: string;
  masked?: boolean;
  /** Awalan label tiap kotak (`Digit 1`, `Digit PIN 1`). */
  digitLabel?: string;
}) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const labelId = useId();
  const firstEmpty = digits.indexOf('');

  const fill = (from: number, text: string) => {
    const clean = text.replace(/\D/g, '');
    if (!clean) return;
    setDigits((prev) => {
      const next = [...prev];
      for (let k = 0; k < clean.length && from + k < 6; k++) next[from + k] = clean.charAt(k);
      return next;
    });
    refs.current[Math.min(from + clean.length, 5)]?.focus();
  };

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((prev) => prev.map((d, k) => (k === i - 1 ? '' : d)));
      refs.current[i - 1]?.focus();
    }
  };

  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(i, e.clipboardData.getData('text'));
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-small font-semibold">
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-6 gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`${digitLabel} ${i + 1}`}
            aria-invalid={Boolean(error)}
            type={masked ? 'password' : 'text'}
            inputMode="numeric"
            autoComplete={masked ? 'off' : i === 0 ? 'one-time-code' : 'off'}
            maxLength={6}
            value={d}
            autoFocus={i === 0}
            onKeyDown={onKeyDown(i)}
            onPaste={onPaste(i)}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '');
              if (raw.length <= 1) {
                setDigits((prev) => prev.map((x, k) => (k === i ? raw : x)));
                if (raw) refs.current[Math.min(i + 1, 5)]?.focus();
              } else {
                // Isi otomatis OTP dari ponsel/pengelola sandi, atau mengetik saat kotak sudah terisi.
                fill(i, d && raw.startsWith(d) ? raw.slice(d.length) : raw);
              }
            }}
            className={cx(
              'h-[52px] rounded-control border text-center font-mono text-[22px]',
              d ? 'border-brand-600 bg-selected' : 'bg-white',
              !d && i === firstEmpty ? (error ? 'border-2 border-danger' : 'border-2 border-brand-600') : '',
              !d && i !== firstEmpty ? (error ? 'border-koral-400' : 'border-line-strong') : '',
            )}
          />
        ))}
      </div>
      <input type="hidden" name={name} value={digits.join('')} />
      {error && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
