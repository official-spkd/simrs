'use client';

import { formatJam } from '@simrs/shared';
import { cx, RadioSegmented } from '@simrs/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

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

const ACK_KEY = 'simrs-dasbor-tindak-lanjut';

/**
 * "Perlu keputusan direksi" (mockup Dasbor): tiap butir bisa ditandai ditindaklanjuti. Di mode presentasi tanda
 * hanya disimpan di browser ini (simulasi); versi produksi mencatatnya di log direksi.
 */
export function DecisionAlerts({ alerts }: { alerts: DashboardAlertView[] }) {
  const [done, setDone] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ACK_KEY);
      if (raw) setDone(JSON.parse(raw) as Record<string, string>);
    } catch {
      // tanpa penyimpanan sesi: mulai kosong
    }
  }, []);
  const toggle = (id: string) =>
    setDone((cur) => {
      const next = { ...cur };
      if (next[id]) delete next[id];
      else next[id] = formatJam(new Date());
      try {
        sessionStorage.setItem(ACK_KEY, JSON.stringify(next));
      } catch {
        // abaikan
      }
      return next;
    });
  const open = alerts.filter((a) => !done[a.id]).length;

  return (
    <section
      aria-label="Perlu keputusan direksi"
      className="flex flex-col gap-2.5 rounded-card border border-line bg-white bg-[linear-gradient(160deg,#FFFFFF_60%,rgba(180,35,24,0.05))] p-4"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Perlu keputusan direksi</span>
        <span
          aria-live="polite"
          className={cx('text-caption font-semibold', open ? 'text-danger' : 'text-success')}
        >
          {open ? `${open} terbuka` : 'semua ditindaklanjuti'}
        </span>
      </span>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {alerts.map((a) => {
          const at = done[a.id];
          return (
            <li key={a.id} className="flex gap-2.5 text-small">
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
                    Ditindaklanjuti {at} · tercatat di log direksi (simulasi)
                  </span>
                )}
                <span className="flex flex-wrap gap-1.5">
                  {a.link && (
                    <Link
                      href={a.link.href}
                      className="inline-flex min-h-11 items-center rounded-[9px] border border-brand-800 bg-white px-2.5 text-[12.5px] font-semibold text-brand-700 no-underline"
                    >
                      {a.link.label}
                    </Link>
                  )}
                  <button
                    type="button"
                    aria-pressed={!!at}
                    onClick={() => toggle(a.id)}
                    className={cx(
                      'min-h-11 cursor-pointer rounded-[9px] border border-line-strong px-2.5 font-[inherit] text-[12.5px] font-medium text-ink-900',
                      at ? 'bg-muted' : 'bg-white',
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
