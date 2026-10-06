'use client';

import { formatRupiah } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useId } from 'react';
import { REKENING } from '@/lib/demo/fixtures/rs';
import { INSTALMENT_MARGIN_PERCENT } from '@/lib/keuangan';
import { ChoiceCards } from './choice-cards';

export const CICIL_STEPS = [
  'Diajukan ke BTN',
  'Diverifikasi BTN (NIK, penghasilan)',
  'Disetujui BTN',
  'Akad digital ditandatangani (TTE)',
  `Dana cair ke rekening RS · BTN ${REKENING.operasional}`,
  'Tagihan RS lunas',
] as const;

export interface CicilanAction {
  label: string;
  enabled: boolean;
  /** Alasan tombol nonaktif (ditampilkan, bukan hanya warna). */
  reason: string;
  onClick: () => void;
}

/**
 * Cicilan BTN (mockup Kasir): pilih tenor, ajukan, lalu ikuti status keputusan BTN sampai dana cair ke rekening RS.
 * Angsuran dibayar pasien ke BTN, bukan ke RS. Dipakai tagihan biasa (lokal) dan pasien skenario (tugas skenario).
 */
export function CicilanBox({
  due,
  tenors,
  tenor,
  onTenor,
  submit,
  done,
  times,
  next,
}: {
  due: bigint;
  tenors: ReadonlyArray<{ id: string; label: string; sub: string }>;
  tenor: string | null;
  /** undefined = tenor terkunci (sudah diajukan). */
  onTenor?: (id: string) => void;
  /** Tombol ajukan; null bila sudah diajukan. */
  submit: CicilanAction | null;
  /** Jumlah tahap `CICIL_STEPS` yang selesai. */
  done: number;
  times: readonly string[];
  next: CicilanAction | null;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5 rounded-control border border-line bg-[#F8FAFB] p-3 text-[12.5px] text-ink-700">
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold text-ink-900">Cicilan BTN · {formatRupiah(due)}</span>
        <span>Pembiayaan kesehatan BTN (simulasi) · keputusan kredit oleh BTN</span>
      </span>
      <ChoiceCards
        legend="Tenor cicilan"
        compact
        className="grid grid-cols-3 gap-1.5"
        value={tenor}
        onChange={(t) => onTenor?.(t)}
        options={tenors.map((t) => ({ ...t, disabled: !onTenor }))}
      />
      <span className="text-caption text-ink-500">
        Estimasi angsuran/bulan · <span className="font-semibold text-warning">simulasi</span> margin{' '}
        {INSTALMENT_MARGIN_PERCENT}% p.a. flat. Angka final ditetapkan BTN setelah verifikasi.
      </span>
      {submit && <ActionButton action={submit} id={`${id}-ajukan`} primary />}
      {done > 0 && (
        <ol aria-label="Status pengajuan cicilan" className="m-0 flex list-none flex-col gap-1 p-0">
          {CICIL_STEPS.map((label, i) => {
            const ok = i < done;
            const cur = i === done;
            return (
              <li key={label} className="grid grid-cols-[14px_1fr_auto] items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cx(
                    'size-2.5 rounded-full border-2',
                    ok
                      ? 'border-brand-600 bg-brand-600'
                      : cur
                        ? 'border-[#E9B26B] bg-white'
                        : 'border-line-strong bg-white',
                  )}
                />
                <span
                  className={cx(ok ? 'text-ink-900' : cur ? 'font-semibold text-warning' : 'text-ink-500')}
                >
                  {label}
                </span>
                <span className="text-caption text-ink-500">
                  {ok ? `selesai ${times[i] ?? ''}` : cur ? 'berikutnya' : ''}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {next && <ActionButton action={next} id={`${id}-lanjut`} />}
      <span className="rounded-[8px] bg-info-bg px-2.5 py-2 text-caption text-info">
        Angsuran dibayar pasien langsung ke BTN, bukan ke RS. Setelah dana cair ke rekening RS (BTN{' '}
        {REKENING.operasional}), tagihan RS lunas dan RS tidak menanggung risiko gagal bayar (kecuali diatur
        lain di perjanjian).
      </span>
    </div>
  );
}

function ActionButton({ action, id, primary }: { action: CicilanAction; id: string; primary?: boolean }) {
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={!action.enabled}
        aria-describedby={action.reason ? id : undefined}
        onClick={action.onClick}
        className={cx(
          'min-h-11 rounded-control px-3.5 font-[inherit] font-semibold',
          !action.enabled
            ? 'cursor-not-allowed border border-line-strong bg-[#E9EDF1] text-ink-500'
            : primary
              ? 'cursor-pointer border border-brand-800 bg-brand-600 text-white'
              : 'cursor-pointer border border-dashed border-brand-700 bg-white text-brand-700',
        )}
      >
        {action.label}
      </button>
      {action.reason && (
        <span id={id} className="text-caption font-medium text-warning">
          {action.reason}
        </span>
      )}
    </span>
  );
}
