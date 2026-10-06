import { cx } from '@simrs/ui';
import type { KioskSessionOption } from '@simrs/shared';
import type { ReactNode } from 'react';
import type { KioskNextStep } from '@/lib/kiosk';
import { initials } from '@/lib/front-office';
import { fs, KIOSK_PRIMARY, KIOSK_SECONDARY, KioskBackRow, KioskNotice, KioskTitle } from './kiosk-ui';

const BIG = 'h-[120px] cursor-pointer rounded-[24px] font-[inherit] font-bold';
const SECOND = 'h-24 cursor-pointer rounded-[22px] font-[inherit] font-semibold';

/**
 * F05 · "Apakah ini data Anda?" mode api: hanya nama tersamar + tanggal lahir tanpa tahun (keputusan fase 2 no. 3),
 * tanpa RM/NIK/poli. Tombol utama mengikuti `kioskNextStep` (check-in, daftar ke poli, pilih dokter, farmasi/kasir,
 * atau nomor loket).
 */
export function KioskMaskedConfirm({
  nameMasked,
  birthDayMonth,
  next,
  step,
  busy,
  onBack,
  onCheckIn,
  onRegister,
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
  /** Daftar ke poli (BPJS) atau lanjut memilih dokter (umum). */
  onRegister: () => void;
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
        className="flex items-center gap-6 rounded-[32px] border-2 border-white bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] px-10 py-9 shadow-card"
      >
        <span
          aria-hidden="true"
          className="flex size-24 flex-none items-center justify-center rounded-full border-[3px] border-brand-600 bg-white font-bold text-brand-800"
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
        {(next === 'register-bpjs' || next === 'register-umum') && (
          <button
            type="button"
            disabled={busy}
            onClick={onRegister}
            className={cx(BIG, KIOSK_PRIMARY)}
            style={fs(32)}
          >
            {busy
              ? 'Mendaftarkan…'
              : next === 'register-bpjs'
                ? 'Ya, data saya benar · daftar ke poli'
                : 'Ya, data saya benar · pilih dokter'}
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

/** F05 · Pasien umum memilih sesi dokter hari ini (informasi publik); sesi penuh tidak bisa dipilih. */
export function KioskSessions({
  sessions,
  step,
  busy,
  onBack,
  onPick,
}: {
  sessions: KioskSessionOption[];
  step: string;
  busy: boolean;
  onBack: () => void;
  onPick: (sessionId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-8 px-16 pt-14">
      <KioskBackRow onBack={onBack} step={step} />
      <KioskTitle title="Pilih dokter" sub="Jadwal praktik hari ini. Sentuh dokter yang ingin Anda temui." />
      {sessions.length === 0 ? (
        <KioskNotice tone="info">
          Tidak ada jadwal praktik hari ini. Silakan ke loket pendaftaran.
        </KioskNotice>
      ) : (
        <div role="list" aria-label="Jadwal dokter hari ini" className="flex flex-col gap-5">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              role="listitem"
              disabled={busy || !s.available}
              onClick={() => onPick(s.sessionId)}
              aria-label={`${s.practitionerName}, ${s.poliName}, ${s.start}–${s.end}${s.available ? '' : ', kuota penuh'}`}
              className={cx(
                'flex min-h-[120px] cursor-pointer items-center justify-between gap-6 rounded-[24px] border-2 px-9 py-6 text-left font-[inherit] disabled:cursor-not-allowed disabled:opacity-60',
                s.available ? 'border-white bg-white shadow-card' : 'border-line bg-muted',
              )}
            >
              <span className="flex flex-col gap-1">
                <span className="font-bold" style={fs(30)}>
                  {s.practitionerName}
                </span>
                <span className="text-ink-700" style={fs(22)}>
                  {s.poliName} · {s.start}–{s.end}
                </span>
              </span>
              <span
                className={cx('font-semibold', s.available ? 'text-brand-700' : 'text-ink-500')}
                style={fs(22)}
              >
                {s.available ? 'Tersedia' : 'Kuota penuh'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
