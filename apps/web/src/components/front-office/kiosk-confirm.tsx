import { cx, Icon } from '@simrs/ui';
import Link from 'next/link';
import { dateLong, initials } from '@/lib/front-office';
import { fs, KIOSK_PRIMARY, KIOSK_SECONDARY, KioskBackRow, KioskNotice, KioskTitle } from './kiosk-ui';

export interface KioskIdentity {
  name: string;
  birthDate: string;
  rm: string;
}

/** F05 · "Apakah ini data Anda?": nama + tanggal lahir + RM (dua pengenal) dan ringkasan tujuan. */
export function KioskConfirm({
  patient,
  rows,
  step,
  busy,
  onBack,
  onConfirm,
  onNotMe,
}: {
  patient: KioskIdentity;
  rows: Array<{ k: string; v: string }>;
  step: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onNotMe: () => void;
}) {
  return (
    <div className="flex flex-col gap-8 px-16 pt-14">
      <KioskBackRow onBack={onBack} step={step} />
      <KioskTitle
        title="Apakah ini data Anda?"
        sub="Periksa nama dan tanggal lahir. Bila tidak sesuai, sentuh Bukan saya."
      />
      <section
        aria-label="Data pasien"
        className="flex flex-col gap-1 rounded-[32px] border-2 border-white bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] px-10 py-9 shadow-card"
      >
        <div className="flex items-center gap-6 pb-5">
          <span
            aria-hidden="true"
            className="flex size-24 flex-none items-center justify-center rounded-full border-[3px] border-brand-600 bg-white font-bold text-brand-800"
            style={fs(36)}
          >
            {initials(patient.name)}
          </span>
          <span className="flex flex-col gap-1">
            <span className="font-bold" style={fs(40)}>
              {patient.name}
            </span>
            <span className="text-ink-700" style={fs(24)}>
              {dateLong(patient.birthDate)} · RM <span className="font-mono">{patient.rm}</span>
            </span>
          </span>
        </div>
        {rows.map((r) => (
          <div
            key={r.k}
            className="flex justify-between gap-6 border-t border-brand-200/70 py-[18px]"
            style={fs(24)}
          >
            <span className="text-ink-500">{r.k}</span>
            <span className="text-right font-semibold">{r.v}</span>
          </div>
        ))}
      </section>
      <div className="flex flex-col gap-5">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={cx('h-[120px] cursor-pointer rounded-[24px] font-[inherit] font-bold', KIOSK_PRIMARY)}
          style={fs(32)}
        >
          {busy ? 'Mencetak tiket…' : 'Ya, data saya benar · cetak tiket'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onNotMe}
          className={cx('h-24 cursor-pointer rounded-[22px] font-[inherit] font-semibold', KIOSK_SECONDARY)}
          style={fs(26)}
        >
          Bukan saya, ulangi
        </button>
      </div>
    </div>
  );
}

export interface KioskTicketView {
  no: string;
  tujuan: string;
  lokasi: string;
  /** Nomor SEP yang ikut tercetak, null bila SEP diterbitkan di loket/tidak perlu. */
  sep: string | null;
  note: string | null;
}

/** F05 · Tiket antrean tercetak. `displayLink`: tautan ke layar TV (mode presentasi; perangkat anjungan tidak). */
export function KioskTicket({
  ticket,
  onDone,
  displayLink = true,
}: {
  ticket: KioskTicketView;
  onDone: () => void;
  displayLink?: boolean;
}) {
  return (
    <div className="flex flex-col items-stretch gap-8 px-16 pt-14">
      <KioskNotice tone="success">Tiket sedang dicetak. Ambil di bawah layar.</KioskNotice>
      <section
        aria-label="Tiket antrean"
        className="flex flex-col items-center gap-4 rounded-[32px] border-2 border-dashed border-brand-200 bg-white px-10 py-12 text-center shadow-[0_10px_30px_rgba(23,32,46,0.12)]"
      >
        <span className="font-semibold tracking-[0.08em] text-brand-700" style={fs(26)}>
          NOMOR ANTREAN ANDA
        </span>
        <span className="font-mono leading-none font-bold tracking-[-0.03em] text-brand-700" style={fs(200)}>
          {ticket.no}
        </span>
        <span className="font-bold" style={fs(36)}>
          {ticket.tujuan}
        </span>
        <span className="text-ink-700" style={fs(26)}>
          {ticket.lokasi}
        </span>
        {ticket.sep && (
          <span className="text-ink-700" style={fs(22)}>
            SEP <span className="font-mono font-semibold text-ink-900">{ticket.sep}</span> ikut tercetak
          </span>
        )}
        {ticket.note && (
          <span className="flex items-center gap-2 text-ink-700" style={fs(22)}>
            <Icon name="info" size={24} />
            {ticket.note}
          </span>
        )}
      </section>
      <button
        type="button"
        onClick={onDone}
        className={cx('h-[120px] cursor-pointer rounded-[24px] font-[inherit] font-bold', KIOSK_PRIMARY)}
        style={fs(34)}
      >
        Selesai
      </button>
      {displayLink && (
        <Link
          href="/display/antrean"
          className="inline-flex min-h-16 items-center self-center px-4 font-semibold text-brand-600"
          style={fs(22)}
        >
          Lihat layar antrean ruang tunggu
        </Link>
      )}
    </div>
  );
}
