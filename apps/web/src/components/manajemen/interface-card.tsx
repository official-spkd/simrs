import type { InterfaceCard as InterfaceCardData } from '@simrs/shared';
import { Chip, type ChipTone, cx } from '@simrs/ui';
import { formatLatency, formatNumber, hourLabel } from '@/lib/manajemen';
import { Sparkbars } from './sparkbars';

const STATUS: Record<InterfaceCardData['status'] | 'antre', { label: string; tone: ChipTone; tint: string }> =
  {
    normal: { label: 'Normal', tone: 'success', tint: 'rgba(15,118,110,0.05)' },
    lambat: { label: 'Lambat', tone: 'warning', tint: 'rgba(138,75,0,0.06)' },
    gangguan: { label: 'Gangguan', tone: 'danger', tint: 'rgba(180,35,24,0.06)' },
    antre: { label: 'Antre lokal', tone: 'neutral', tint: 'rgba(63,76,88,0.06)' },
  };

function sparkLabel(card: InterfaceCardData): string {
  const max = Math.max(...card.hourly);
  const peak = card.hourly.indexOf(max);
  const err = card.errorHours.map((i) => hourLabel(i)).join(', ');
  return `Volume per jam 24 jam terakhir, puncak ${formatNumber(max)} pesan pukul ${hourLabel(peak)}${
    err ? `; galat pukul ${err}` : '; tanpa galat'
  }`;
}

/**
 * Kartu status satu antarmuka (I01–I06). Seluruh kartu adalah tombol penyaring dead-letter queue
 * (`aria-pressed`). Saat uji downtime, antarmuka eksternal berstatus "Antre lokal" dengan jumlah pesan tertahan.
 */
export function InterfaceCard({
  card,
  failed,
  queued,
  synced,
  holding,
  pressed,
  onSelect,
}: {
  card: InterfaceCardData;
  /** Gagal hari ini setelah dikurangi pesan yang sudah dikirim ulang. */
  failed: number;
  /** Pesan tertahan di antrean lokal selama uji downtime. */
  queued: number;
  /** Pesan antrean lokal yang sudah disinkronkan setelah pulih (menambah volume). */
  synced: number;
  holding: boolean;
  pressed: boolean;
  onSelect: () => void;
}) {
  const s = STATUS[holding && card.status !== 'gangguan' ? 'antre' : card.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={pressed}
      title={`Saring dead-letter queue ke ${card.name}`}
      className={cx(
        'flex w-full cursor-pointer flex-col gap-1.5 rounded-card border bg-white p-3.5 text-left font-[inherit] text-ink-900',
        pressed
          ? 'border-brand-600 shadow-[0_0_0_1px_#0F766E,0_4px_12px_rgba(15,118,110,0.18)]'
          : 'border-line',
      )}
      style={{ backgroundImage: `linear-gradient(160deg, #FFFFFF 60%, ${s.tint})` }}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="font-semibold">{card.name}</span>
        <Chip tone={s.tone}>{s.label}</Chip>
      </span>
      <span className="text-caption text-ink-500">{card.protocol}</span>
      <span className="flex flex-wrap gap-x-3.5 gap-y-0.5 text-[12.5px] text-ink-700">
        <span>
          Hari ini:{' '}
          <span className="font-mono font-semibold text-ink-900">
            {formatNumber(card.volumeToday + synced)}
          </span>
        </span>
        <span>
          gagal:{' '}
          <span className={cx('font-mono font-semibold', failed > 0 ? 'text-danger' : 'text-ink-900')}>
            {failed}
          </span>
        </span>
        <span>
          p95: <span className="font-mono">{formatLatency(card.p95Ms)}</span>
        </span>
      </span>
      {(card.scenarioVolume > 0 || queued > 0) && (
        <span className="flex flex-wrap gap-x-3 text-[12px]">
          {card.scenarioVolume > 0 && (
            <span className="text-brand-700">
              +{formatNumber(card.scenarioVolume)} dari skenario Simulasi
            </span>
          )}
          {queued > 0 && (
            <span className="font-semibold text-warning">
              {formatNumber(queued)} pesan tertahan di antrean lokal
            </span>
          )}
        </span>
      )}
      <Sparkbars values={card.hourly} errorIndexes={card.errorHours} label={sparkLabel(card)} />
    </button>
  );
}
