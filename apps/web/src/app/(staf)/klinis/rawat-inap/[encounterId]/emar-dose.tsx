'use client';

import { type EmarMedication, type EmarTime, SAFETY_REASON_MIN } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { emarLabelCode, signerNameMatches } from '@/lib/rawat-inap';

export interface DoseInput {
  labelCode: string;
  lateReason: string | null;
  doubleCheckedBy: string | null;
}

/**
 * Pemberian SATU dosis (mockup Ranap: klik slot → pindai label obat → catat): label obat dipindai (simulasi),
 * dosis terlambat wajib alasan, obat kewaspadaan tinggi wajib cek ganda perawat kedua. Semua diperiksa ulang server.
 */
export function EmarDosePanel({
  med,
  time,
  late,
  nurse,
  busy,
  error,
  onRecord,
  onCancel,
}: {
  med: EmarMedication;
  time: EmarTime;
  late: boolean;
  nurse: string;
  busy: boolean;
  error: string | null;
  onRecord: (d: DoseInput) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLElement | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [second, setSecond] = useState('');
  useEffect(() => box.current?.focus(), []);

  const blocker = !label
    ? 'Pindai label obat dulu.'
    : late && reason.trim().length < SAFETY_REASON_MIN
      ? `Isi alasan keterlambatan (minimal ${SAFETY_REASON_MIN} karakter).`
      : med.highAlert && second.trim().length < 3
        ? 'Isi nama perawat kedua yang melakukan cek ganda.'
        : med.highAlert && signerNameMatches(second, nurse)
          ? 'Cek ganda harus oleh petugas lain, bukan pemberi obat.'
          : null;

  return (
    <section
      ref={box}
      id="emar-dosis"
      tabIndex={-1}
      aria-labelledby={`${id}-judul`}
      className={cx(
        'flex flex-col gap-2.5 rounded-control border p-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        late
          ? 'border-koral-200 bg-alert-critical'
          : 'border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))]',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-judul`} className={cx('m-0 text-body font-semibold', late && 'text-danger-strong')}>
          {med.name} · jadwal {time}
          {late ? ' terlambat' : ''}
        </h3>
        {med.highAlert && <Chip tone="danger">Kewaspadaan tinggi · cek ganda</Chip>}
      </div>
      <span className="text-caption text-ink-700">{med.sig}</span>

      <div className="flex flex-wrap items-center gap-2.5">
        <span
          role="status"
          className={cx('text-small font-semibold', label ? 'text-success' : 'text-ink-700')}
        >
          {label ? `✓ Obat benar · label terpindai (${med.name})` : '○ Obat · label belum dipindai'}
        </span>
        {!label && (
          <Button disabled={busy} onClick={() => setLabel(emarLabelCode(med))}>
            Pindai label obat
          </Button>
        )}
      </div>

      {late && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-telat`} className="text-small font-semibold">
            Alasan keterlambatan (wajib, minimal {SAFETY_REASON_MIN} karakter, tercatat di jejak audit)
          </label>
          <input
            id={`${id}-telat`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: pasien sedang pemeriksaan foto toraks"
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          />
        </div>
      )}
      {med.highAlert && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-cek`} className="text-small font-semibold">
            Cek ganda: nama perawat kedua (wajib, bukan pemberi obat)
          </label>
          <input
            id={`${id}-cek`}
            value={second}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => setSecond(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={late ? 'danger' : 'primary'}
          disabled={!!blocker || busy}
          aria-describedby={blocker ? `${id}-syarat` : undefined}
          onClick={() =>
            label &&
            onRecord({
              labelCode: label,
              lateReason: late ? reason.trim() : null,
              doubleCheckedBy: med.highAlert ? second.trim() : null,
            })
          }
        >
          {late ? 'Catat pemberian terlambat' : 'Catat pemberian'}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Batal
        </Button>
        {blocker && (
          <span id={`${id}-syarat`} className="text-caption text-ink-700">
            {blocker}
          </span>
        )}
      </div>
      {error && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {error}
        </span>
      )}
    </section>
  );
}
