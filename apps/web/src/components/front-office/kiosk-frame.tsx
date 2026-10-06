import { cx, Icon } from '@simrs/ui';
import { fs, KIOSK_SECONDARY, KioskNotice } from './kiosk-ui';

/** Kepala anjungan: nama RS (sesi tenant) dan jam/tanggal hari demo. */
export function KioskHeader({ tenantName, time, date }: { tenantName: string; time: string; date: string }) {
  return (
    <header className="flex items-center justify-between gap-6 px-16 pt-12">
      <div className="flex items-center gap-[18px]">
        <div className="flex size-[72px] flex-none items-center justify-center rounded-[18px] bg-fajar text-white shadow-[0_6px_16px_rgba(44,85,196,0.35)]">
          <Icon name="plus" size={34} strokeWidth={2.2} />
        </div>
        <div className="flex flex-col">
          <span className="font-bold" style={fs(30)}>
            {tenantName}
          </span>
          <span className="text-ink-700" style={fs(20)}>
            Anjungan Pendaftaran Mandiri
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono font-semibold" style={fs(44)}>
          <span className="sr-only">Pukul </span>
          {time}
        </span>
        <span className="text-ink-700" style={fs(20)}>
          {date}
        </span>
      </div>
    </header>
  );
}

/** Kaki anjungan: status panggil petugas, info BPJS, dan tombol bahasa, huruf besar, panggil petugas. */
export function KioskFooter({
  calledAt,
  english,
  large,
  onEnglish,
  onLarge,
  onCall,
  cancelable = true,
  calling = false,
}: {
  calledAt: string | null;
  english: boolean;
  large: boolean;
  onEnglish: () => void;
  onLarge: () => void;
  onCall: () => void;
  /** Panggilan bisa dibatalkan (mode presentasi). Mode api: notifikasi sudah terkirim, tombol menjadi status. */
  cancelable?: boolean;
  /** Permintaan panggil petugas sedang dikirim. */
  calling?: boolean;
}) {
  const btn = 'h-24 flex-1 cursor-pointer rounded-[22px] font-[inherit] font-semibold';
  return (
    <div className="mt-auto flex flex-col gap-6 px-16 pt-6 pb-14">
      {calledAt && (
        <KioskNotice tone="info">
          Petugas dipanggil pukul {calledAt} dan segera menuju anjungan ini. Mohon tunggu.
        </KioskNotice>
      )}
      {english && (
        <KioskNotice tone="info">
          English version coming soon. Bahasa Inggris segera tersedia; petugas siap membantu.
        </KioskNotice>
      )}
      <div className="flex items-center gap-5 rounded-[22px] border border-white/95 bg-white/90 px-7 py-6 shadow-card">
        <Icon name="info" size={32} className="flex-none text-brand-700" />
        <span className="text-ink-700" style={fs(22)}>
          Pasien BPJS: siapkan kartu atau NIK. Verifikasi wajah atau sidik jari diperlukan untuk penerbitan
          SEP sesuai ketentuan BPJS.
        </span>
      </div>
      <div className="flex gap-5">
        <button type="button" onClick={onEnglish} className={cx(btn, KIOSK_SECONDARY)} style={fs(26)}>
          English
        </button>
        <button
          type="button"
          aria-pressed={large}
          onClick={onLarge}
          className={cx(
            btn,
            large ? 'border-2 border-brand-600 bg-brand-100 text-brand-800' : KIOSK_SECONDARY,
          )}
          style={fs(26)}
        >
          Huruf lebih besar
        </button>
        <button
          type="button"
          aria-pressed={!!calledAt}
          disabled={calling || (!cancelable && !!calledAt)}
          onClick={onCall}
          className={cx(
            btn,
            'flex-[1.4] border-2 font-bold',
            calledAt
              ? 'border-brand-700 bg-white text-brand-700'
              : 'border-transparent bg-btn-primary text-white shadow-button',
          )}
          style={fs(26)}
        >
          {calling
            ? 'Memanggil petugas…'
            : calledAt
              ? cancelable
                ? 'Batalkan panggilan'
                : 'Petugas dipanggil'
              : 'Panggil petugas'}
        </button>
      </div>
    </div>
  );
}
