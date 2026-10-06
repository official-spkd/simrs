'use client';

import { formatJam } from '@simrs/shared';
import { cx, RadioSegmented } from '@simrs/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CARD, H2, SOFT } from '@/components/backoffice/styles';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { dashboardAlertKey } from '@/lib/dasbor-toko';
import { demoNow } from '@/lib/demo/fixtures/waktu';

/** Pilihan rentang KPI (Hari ini / Bulan berjalan / YTD) lewat URL `?periode=`. */
export function PeriodSwitch({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <RadioSegmented
      label="Rentang"
      value={value}
      disabled={pending}
      items={[
        { id: 'hari-ini', label: 'Hari ini' },
        { id: 'bulan', label: 'Bulan berjalan' },
        { id: 'ytd', label: 'YTD' },
      ]}
      onChange={(id) => startTransition(() => router.replace(`${pathname}?periode=${id}`, { scroll: false }))}
    />
  );
}

export interface DashboardAlertView {
  id: string;
  title: string;
  detail: string;
  severity: 'kritis' | 'perhatian';
  link: { href: string; label: string } | null;
}

/**
 * "Perlu keputusan direksi" (mockup Dasbor): tiap butir bisa ditandai ditindaklanjuti oleh posisi Manajemen; tanda
 * tersimpan di log direksi (toko demo, domain `dasbor`) atas nama pengguna sesi. Butir yang isinya berubah terbuka
 * lagi.
 */
export function DecisionAlerts({
  alerts,
  acks,
  rev,
  canDecide,
}: {
  alerts: DashboardAlertView[];
  acks: Readonly<Record<string, { title: string; jam: string; by: string }>>;
  rev: number;
  canDecide: boolean;
}) {
  const { act, pending, flash } = useTokoAction('dasbor', rev);
  const done: Record<string, { jam: string; by: string } | undefined> = Object.fromEntries(
    alerts.map((a) => [a.id, acks[dashboardAlertKey(a)]]),
  );
  const toggle = (a: DashboardAlertView) => {
    const jam = formatJam(demoNow());
    const key = dashboardAlertKey(a);
    if (done[a.id]) act({ type: 'alert.dibatalkan', key, jam }, null);
    else act({ type: 'alert.ditandai', key, title: a.title, jam }, null);
  };
  const open = alerts.filter((a) => !done[a.id]).length;

  return (
    <section aria-label="Perlu keputusan direksi" className={cx('flex flex-col gap-2.5 p-4', CARD)}>
      <span className="flex items-baseline justify-between gap-2">
        <h2 className={H2}>Perlu keputusan direksi</h2>
        <span
          aria-live="polite"
          className={cx('text-caption font-semibold', open ? 'text-danger' : 'text-success')}
        >
          {open ? `${open} terbuka` : 'semua ditindaklanjuti'}
        </span>
      </span>
      {flash && !flash.ok && (
        <span role="status" className="text-caption font-medium text-warning">
          {flash.text}
        </span>
      )}
      {!canDecide && (
        <span className="text-caption text-ink-500">Tanda tindak lanjut oleh posisi Manajemen.</span>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {alerts.map((a) => {
          const ack = done[a.id];
          const at = ack?.jam;
          return (
            <li key={a.id} className={cx('flex gap-2.5 p-3 text-small', SOFT)}>
              <span
                aria-hidden="true"
                className={cx(
                  'mt-1.5 size-2 flex-none rounded-full',
                  at ? 'bg-success' : a.severity === 'kritis' ? 'bg-danger' : 'bg-warning',
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex flex-col">
                  <span className={cx('font-semibold', at ? 'text-ink-500' : 'text-ink-900')}>
                    <span className="sr-only">{a.severity === 'kritis' ? 'Kritis: ' : 'Perhatian: '}</span>
                    {a.title}
                  </span>
                  <span className="text-ink-700">{a.detail}</span>
                </span>
                {at && (
                  <span className="text-caption font-semibold text-success">
                    Ditindaklanjuti {at} · {ack?.by} · tercatat di log direksi
                  </span>
                )}
                <span className="flex flex-wrap gap-1.5">
                  {a.link && (
                    <Link
                      href={a.link.href}
                      className="inline-flex min-h-11 items-center rounded-control border border-[rgba(23,32,46,0.12)] bg-white/95 px-3 text-[12.5px] font-semibold text-brand-700 no-underline hover:shadow-[0_6px_16px_rgba(23,32,46,0.12)]"
                    >
                      {a.link.label}
                    </Link>
                  )}
                  <button
                    type="button"
                    aria-pressed={!!at}
                    disabled={pending || !canDecide}
                    onClick={() => toggle(a)}
                    className={cx(
                      'min-h-11 cursor-pointer rounded-control border px-3 font-[inherit] text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:border-batu-200 disabled:bg-batu-200 disabled:bg-none disabled:text-ink-500 disabled:shadow-none',
                      at
                        ? 'border-[rgba(23,32,46,0.12)] bg-white/95 text-ink-900'
                        : 'border-transparent bg-btn-primary text-white shadow-button',
                    )}
                  >
                    {at ? 'Batalkan tanda' : 'Tandai ditindaklanjuti'}
                  </button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
