import { cx } from '@simrs/ui';
import type { ReactNode } from 'react';
import type { KioskNextStep } from '@/lib/kiosk';
import { initials } from '@/lib/front-office';
import { fs, KIOSK_PRIMARY, KIOSK_SECONDARY, KioskBackRow, KioskNotice, KioskTitle } from './kiosk-ui';

const BIG = 'h-[120px] cursor-pointer rounded-[24px] font-[inherit] font-bold';
const SECOND = 'h-24 cursor-pointer rounded-[22px] font-[inherit] font-semibold';

/**
 * F05 · "Apakah ini data Anda?" mode api: hanya nama tersamar + tanggal lahir tanpa tahun (keputusan fase 2 no. 3),
 * tanpa RM/NIK/poli. Tombol utama mengikuti `kioskNextStep` (check-in, farmasi/kasir, atau nomor loket).
 */
export function KioskMaskedConfirm({
  nameMasked,
  birthDayMonth,
  next,
  step,
  busy,
  onBack,
  onCheckIn,
  onTicket,
  onNotMe,
}: {
  nameMasked: string;
  birthDayMonth: string;
  next: KioskNextStep;
  step: string;
  busy: boolean;
  onBack: () => void;
  onCheckIn: () => void;
  onTicket: (kind: 'loket' | 'farmasi' | 'kasir') => void;
  onNotMe: () => void;
}) {
  return (
    <div className="flex flex-col gap-8 px-16 pt-14">
      <KioskBackRow onBack={onBack} step={step} />
      <KioskTitle
        title="Apakah ini data Anda?"
        sub="Sebagian nama sengaja disamarkan. Bila tidak sesuai, sentuh Bukan saya."
      />
      <section
        aria-label="Data pasien"
        className="flex items-center gap-6 rounded-[28px] border-2 border-[#D5E3E1] bg-[linear-gradient(160deg,rgba(15,118,110,0.08),#FFFFFF_55%)] px-10 py-9"
      >
        <span
          aria-hidden="true"
          className="flex size-24 flex-none items-center justify-center rounded-full border-[3px] border-brand-600 bg-white font-bold text-brand-700"
          style={fs(36)}
        >
          {initials(nameMasked)}
        </span>
        <span className="flex flex-col gap-1">
          <span className="font-mono font-bold tracking-[0.04em]" style={fs(40)} data-testid="nama-tersamar">
            {nameMasked}
          </span>
          <span className="text-ink-700" style={fs(24)}>
            Tanggal lahir {birthDayMonth}
          </span>
        </span>
      </section>
      {next === 'loket' && (
        <KioskNotice tone="info">
          Pendaftaran dari anjungan segera tersedia. Petugas loket akan mendaftarkan Anda.
        </KioskNotice>
      )}
      <div className="flex flex-col gap-5">
        {next === 'check-in' && (
          <button
            type="button"
            disabled={busy}
            onClick={onCheckIn}
            className={cx(BIG, KIOSK_PRIMARY)}
            style={fs(32)}
          >
            {busy ? 'Mencetak tiket…' : 'Ya, data saya benar · check-in'}
          </button>
        )}
        {next === 'farmasi-kasir' && (
          <div className="grid grid-cols-2 gap-5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onTicket('farmasi')}
              className={cx(BIG, KIOSK_PRIMARY)}
              style={fs(30)}
            >
              Antrean farmasi
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onTicket('kasir')}
              className={cx(BIG, KIOSK_PRIMARY)}
              style={fs(30)}
            >
              Antrean kasir
            </button>
          </div>
        )}
        {next === 'loket' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onTicket('loket')}
            className={cx(BIG, KIOSK_PRIMARY)}
            style={fs(32)}
          >
            {busy ? 'Mencetak tiket…' : 'Ya, data saya benar · ambil nomor loket'}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onNotMe}
          className={cx(SECOND, KIOSK_SECONDARY)}
          style={fs(26)}
        >
          Bukan saya, ulangi
        </button>
      </div>
    </div>
  );
}

/** F05 · Data tidak ditemukan / perlu dibantu petugas: tawarkan nomor antrean loket pendaftaran (tanpa identitas). */
export function KioskToCounter({
  message,
  busy,
  onTicket,
  onRetry,
}: {
  message: ReactNode;
  busy: boolean;
  onTicket: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-8 px-16 pt-14">
      <KioskTitle
        title="Petugas loket siap membantu"
        sub="Ambil nomor antrean, lalu tunggu nomor Anda dipanggil."
      />
      <KioskNotice tone="warning">{message}</KioskNotice>
      <button
        type="button"
        disabled={busy}
        onClick={onTicket}
        className={cx(BIG, KIOSK_PRIMARY)}
        style={fs(32)}
      >
        {busy ? 'Mencetak tiket…' : 'Ambil nomor antrean loket pendaftaran'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onRetry}
        className={cx(SECOND, KIOSK_SECONDARY)}
        style={fs(26)}
      >
        Ulangi dari awal
      </button>
    </div>
  );
}
