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
  place,
  room,
  history,
}: {
  queueNo: string;
  poliName: string;
  /** Tujuan panggilan lengkap (mis. "Loket pendaftaran"); bawaan "Poli <poliName>". */
  place?: string;
  room: string;
  history: string[];
}) {
  return (
    <section
      aria-label="Sedang dipanggil"
      aria-live="polite"
      className="flex flex-[1.15] flex-col justify-between rounded-[36px] p-12 text-white shadow-[0_16px_40px_rgba(44,85,196,0.3)]"
      style={{
        // Gradien satu rona domain (800 → 600) + cahaya putih lembut; tanpa gradien lintas rona.
        backgroundColor: 'var(--color-brand-700)',
        backgroundImage:
          'radial-gradient(700px 400px at 100% 0%, rgba(255,255,255,0.14), rgba(255,255,255,0) 70%), linear-gradient(150deg, var(--color-brand-800), var(--color-brand-600))',
      }}
    >
      <span className="text-[32px] font-semibold tracking-[0.06em] text-brand-100">SEDANG DIPANGGIL</span>
      <span className="font-mono text-[260px] leading-none font-bold tracking-[-0.04em]">{queueNo}</span>
      <div className="flex flex-col gap-2">
        <span className="text-[56px] font-bold">
          {place ?? (poliName ? `Poli ${poliName}` : 'Belum ada panggilan')}
        </span>
        <span className="text-[40px] text-brand-100">{room}</span>
      </div>
      <div aria-label="Panggilan sebelumnya" className="flex flex-wrap items-center gap-3.5">
        <span className="text-[24px] font-semibold text-brand-100">Sebelumnya</span>
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
      className="flex flex-col gap-2.5 rounded-[28px] border border-white/95 bg-white/90 px-[30px] py-7 shadow-card"
    >
      <span className="text-[26px] font-bold">{c.name}</span>
      <span className="text-[20px] text-ink-700">{c.room}</span>
      <span className="font-mono text-[86px] leading-[1.05] font-bold tracking-[-0.03em] text-brand-700">
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
