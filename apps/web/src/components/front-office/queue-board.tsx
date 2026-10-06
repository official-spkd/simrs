import { cx, Icon } from '@simrs/ui';

export interface BoardClinicView {
  poliCode: string;
  name: string;
  room: string;
  current: string;
  next: string;
  note: string;
  warn: boolean;
}

const HISTORY_OPACITY = [1, 0.9, 0.8, 0.7];

/** F04 · Panel besar "SEDANG DIPANGGIL" (diumumkan pembaca layar) dan riwayat panggilan. */
export function CallingPanel({
  queueNo,
  poliName,
  room,
  history,
}: {
  queueNo: string;
  poliName: string;
  room: string;
  history: string[];
}) {
  return (
    <section
      aria-label="Sedang dipanggil"
      aria-live="polite"
      className="flex flex-[1.15] flex-col justify-between rounded-[32px] p-12 text-white shadow-[0_16px_40px_rgba(11,93,86,0.25)]"
      style={{
        backgroundColor: '#0B5D56',
        backgroundImage:
          'radial-gradient(700px 400px at 100% 0%, rgba(255,255,255,0.14), rgba(255,255,255,0) 70%), radial-gradient(circle at 1px 1px, rgba(255,255,255,0.10) 1.2px, rgba(255,255,255,0) 1.8px), linear-gradient(150deg, #12807A, #0B5D56)',
        backgroundSize: 'auto, 26px 26px, auto',
      }}
    >
      <span className="text-[32px] font-semibold tracking-[0.06em] text-[#CDEBE5]">SEDANG DIPANGGIL</span>
      <span className="font-mono text-[260px] leading-none font-bold tracking-[-0.02em]">{queueNo}</span>
      <div className="flex flex-col gap-2">
        <span className="text-[56px] font-bold">{poliName ? `Poli ${poliName}` : 'Belum ada panggilan'}</span>
        <span className="text-[40px] text-[#DDF2EE]">{room}</span>
      </div>
      <div aria-label="Panggilan sebelumnya" className="flex flex-wrap items-center gap-3.5">
        <span className="text-[24px] font-semibold text-[#CDEBE5]">Sebelumnya</span>
        {history.map((h, i) => (
          <span
            key={`${h}-${i}`}
            className="rounded-xl border border-white/25 bg-white/10 px-4 py-1 font-mono text-[32px] font-semibold"
            style={{ opacity: HISTORY_OPACITY[i] ?? 0.7 }}
          >
            {h}
          </span>
        ))}
      </div>
    </section>
  );
}

/** F04 · Kartu antrean satu poli: nomor dilayani, dua nomor berikutnya, catatan (keterlambatan = peringatan). */
export function ClinicCard({ c }: { c: BoardClinicView }) {
  return (
    <div
      aria-label={`Poli ${c.name}`}
      role="group"
      className="flex flex-col gap-2.5 rounded-[26px] border border-line bg-white/95 px-[30px] py-7 shadow-[0_4px_14px_rgba(16,24,40,0.06)]"
    >
      <span className="text-[26px] font-bold">{c.name}</span>
      <span className="text-[20px] text-ink-700">{c.room}</span>
      <span className="font-mono text-[86px] leading-[1.05] font-bold text-brand-700">
        <span className="sr-only">Dilayani </span>
        {c.current}
      </span>
      <span className="text-[22px] text-ink-700">
        Berikutnya: <span className="font-mono font-semibold text-ink-900">{c.next}</span>
      </span>
      <span
        className={cx(
          'flex items-center gap-2 text-[20px] font-semibold',
          c.warn ? 'text-warning' : 'text-ink-500',
        )}
      >
        {c.warn && <Icon name="alert" size={22} strokeWidth={2.2} />}
        {c.warn && <span className="sr-only">Perhatian: </span>}
        {c.note}
      </span>
    </div>
  );
}
