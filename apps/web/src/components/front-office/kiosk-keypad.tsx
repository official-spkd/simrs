import { cx } from '@simrs/ui';
import type { ReactNode } from 'react';
import { keypadDisplay, keypadHint } from '@/lib/front-office';
import { fs, KIOSK_PRIMARY, KioskBackRow, KioskTitle } from './kiosk-ui';

export interface KioskMethod {
  id: 'nik' | 'booking' | 'bpjs';
  title: string;
  desc: string;
  len: number;
}

const NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** F05 · Isian angka besar (NIK 16, kode booking 10, kartu BPJS 13 digit) dengan Kosongkan/Hapus dan Lanjut. */
export function KioskKeypad({
  method,
  digits,
  step,
  busy,
  notice,
  onDigits,
  onBack,
  onNext,
}: {
  /** Cara identifikasi, atau isian lain berpanjang tetap (mis. tanggal + bulan lahir DDMM). */
  method: Pick<KioskMethod, 'title' | 'desc' | 'len'>;
  digits: string;
  step: string;
  busy: boolean;
  /** Pesan di bawah isian (mis. kode booking sudah check-in). */
  notice: ReactNode;
  onDigits: (digits: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const full = digits.length >= method.len;
  const press = (d: string) => {
    if (digits.length < method.len) onDigits(digits + d);
  };
  const key =
    'h-[124px] cursor-pointer rounded-[24px] border-2 font-[inherit] font-semibold text-ink-900 shadow-[0_2px_4px_rgba(16,24,40,0.05)]';
  return (
    <div className="flex flex-col gap-8 px-16 pt-14">
      <KioskBackRow onBack={onBack} step={step} />
      <KioskTitle title={`Masukkan ${method.title}`} sub={`${method.desc}. Sentuh angka pada layar.`} />
      <div
        role="status"
        aria-live="polite"
        aria-label={`${method.title}: ${digits || 'kosong'}`}
        className={cx(
          'flex flex-col gap-2.5 rounded-[26px] border-2 bg-white px-9 py-7 shadow-[0_2px_4px_rgba(16,24,40,0.05)]',
          full ? 'border-brand-600' : 'border-line-strong',
        )}
      >
        <span className="font-mono font-semibold tracking-[0.06em] whitespace-nowrap" style={fs(60)}>
          {keypadDisplay(digits, method.len)}
        </span>
        <span className={cx('font-semibold', full ? 'text-success' : 'text-ink-700')} style={fs(22)}>
          {keypadHint(digits, method.len)}
        </span>
      </div>
      {notice}
      <div role="group" aria-label="Keypad angka" className="grid grid-cols-3 gap-5">
        {NUM.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Angka ${n}`}
            onClick={() => press(n)}
            className={cx(key, 'border-line bg-white font-mono')}
            style={fs(48)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          aria-label="Kosongkan semua angka"
          onClick={() => onDigits('')}
          className={cx(key, 'border-line-strong bg-muted')}
          style={fs(26)}
        >
          Kosongkan
        </button>
        <button
          type="button"
          aria-label="Angka 0"
          onClick={() => press('0')}
          className={cx(key, 'border-line bg-white font-mono')}
          style={fs(48)}
        >
          0
        </button>
        <button
          type="button"
          aria-label="Hapus satu angka terakhir"
          onClick={() => onDigits(digits.slice(0, -1))}
          className={cx(key, 'border-line-strong bg-muted')}
          style={fs(26)}
        >
          Hapus
        </button>
      </div>
      <button
        type="button"
        disabled={!full || busy}
        onClick={onNext}
        className={cx('h-[112px] cursor-pointer rounded-[24px] font-[inherit] font-bold', KIOSK_PRIMARY)}
        style={fs(32)}
      >
        {busy ? 'Memeriksa…' : 'Lanjut'}
      </button>
    </div>
  );
}
