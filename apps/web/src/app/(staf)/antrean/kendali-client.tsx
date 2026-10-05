'use client';

import {
  formatJam,
  QUEUE_SERVICE_KIND_LABEL,
  QUEUE_TICKET_STATUS_LABEL,
  type QueueService,
  type QueueTicket,
  type QueueTicketStatus,
} from '@simrs/shared';
import { Button, Chip, type ChipTone, cx, Icon, type IconName } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import {
  counterOptions,
  groupTickets,
  nextCallable,
  TICKET_ACTION_LABEL,
  type TicketAction,
  ticketActions,
} from '@/lib/queue-board';
import { callNextAction, issueTicketAction, type QueueActionResult, ticketAction } from './actions';

/** Penanda status: teks + ikon (status tidak hanya lewat warna). */
const STATUS_VIEW: Record<QueueTicketStatus, { tone: ChipTone; icon: IconName }> = {
  waiting: { tone: 'neutral', icon: 'clock' },
  called: { tone: 'brand', icon: 'bell' },
  serving: { tone: 'info', icon: 'play' },
  done: { tone: 'success', icon: 'check' },
  skipped: { tone: 'warning', icon: 'arrowRight' },
  cancelled: { tone: 'neutral', icon: 'x' },
};

const REFRESH_MS = 15_000;
const counterKey = (serviceId: string) => `simrs.antrean.loket.${serviceId}`;

function StatusChip({ status }: { status: QueueTicketStatus }) {
  const v = STATUS_VIEW[status];
  return (
    <Chip tone={v.tone}>
      <span className="inline-flex items-center gap-1.5">
        <Icon name={v.icon} size={14} strokeWidth={2.2} />
        {QUEUE_TICKET_STATUS_LABEL[status]}
      </span>
    </Chip>
  );
}

/**
 * F04 · Kendali antrean (klien): pilihan layanan (tautan), loket/ruang pemanggil (diingat per layanan di perangkat
 * ini), "Panggil berikutnya", dan aksi per tiket. Daftar diperbarui setiap aksi dan tiap 15 detik.
 */
export function KendaliClient({
  services,
  selected,
  tickets,
  canCall,
}: {
  services: QueueService[];
  selected: QueueService;
  tickets: QueueTicket[];
  canCall: boolean;
}) {
  const router = useRouter();
  const counterId = useId();
  // Halaman memasang ulang komponen ini per layanan (`key`), jadi loket awal selalu milik layanan terpilih.
  const options = counterOptions(selected);
  const [counter, setCounter] = useState(options[0] ?? selected.name);
  const [result, setResult] = useState<QueueActionResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(counterKey(selected.id));
      if (saved && options.includes(saved)) setCounter(saved);
    } catch {
      // Penyimpanan lokal tidak tersedia: pakai loket pertama.
    }
    // `options` diturunkan dari `selected`; cukup bergantung pada id layanan.
  }, [selected.id]);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const chooseCounter = (v: string) => {
    setCounter(v);
    try {
      window.localStorage.setItem(counterKey(selected.id), v);
    } catch {
      // abaikan
    }
  };

  const run = (fn: () => Promise<QueueActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      router.refresh();
    });

  const g = groupTickets(tickets);
  const next = nextCallable(tickets);

  const row = (t: QueueTicket) => (
    <li
      key={t.id}
      className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-white px-4 py-2.5"
      aria-label={`${t.queueNo} · ${QUEUE_TICKET_STATUS_LABEL[t.status]}`}
    >
      <span className="min-w-20 font-mono text-[20px] font-semibold">{t.queueNo}</span>
      <StatusChip status={t.status} />
      <span className="text-small text-ink-500">
        {t.counter ? `${t.counter} · ` : ''}
        {t.calledAt ? `dipanggil ${formatJam(t.calledAt)}` : `ambil ${formatJam(t.issuedAt)}`}
        {t.callCount > 1 ? ` · ${t.callCount}× dipanggil` : ''}
        {t.reserved ? ' · nomor booking' : ''}
      </span>
      {canCall && (
        <span className="ml-auto flex flex-wrap gap-2">
          {ticketActions(t.status).map((a: TicketAction) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'finish' || a === 'start' ? 'primary' : 'secondary'}
              disabled={pending}
              onClick={() =>
                run(() =>
                  a === 'call' || a === 'recall'
                    ? ticketAction({ ticketId: t.id, action: a, counter })
                    : ticketAction({ ticketId: t.id, action: a }),
                )
              }
              aria-label={`${TICKET_ACTION_LABEL[a]} ${t.queueNo}`}
            >
              {TICKET_ACTION_LABEL[a]}
            </Button>
          ))}
        </span>
      )}
    </li>
  );

  const section = (title: string, list: QueueTicket[], empty: string) => (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 text-h3 font-semibold">
        {title} <span className="text-ink-500">· {list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="m-0 text-small text-ink-500">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">{list.map(row)}</ul>
      )}
    </section>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-h1 font-semibold">Kendali antrean</h1>
        <p className="m-0 text-small text-ink-700">
          Panggilan tampil langsung di display ruang tunggu dan diumumkan suara. Nomor booking dipanggil dari
          daftarnya, bukan lewat “Panggil berikutnya”.
        </p>
      </div>

      <nav aria-label="Layanan antrean" className="flex flex-wrap gap-2">
        {services.map((s) => (
          <Link
            key={s.id}
            href={`/antrean?layanan=${s.id}`}
            aria-current={s.id === selected.id ? 'page' : undefined}
            className={cx(
              'inline-flex min-h-11 items-center gap-2 rounded-control border px-3.5 font-medium no-underline',
              s.id === selected.id
                ? 'border-brand-700 bg-brand-50 text-brand-800'
                : 'border-line-strong bg-white text-ink-900',
            )}
          >
            <span className="font-mono font-semibold">{s.code}</span>
            {s.name}
          </Link>
        ))}
      </nav>

      <section
        aria-label="Panggilan"
        className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-white p-4"
      >
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-500">{QUEUE_SERVICE_KIND_LABEL[selected.kind]}</span>
          <span className="text-h3 font-semibold">
            {selected.name}
            {selected.room ? ` · ${selected.room}` : ''}
          </span>
        </div>
        <label htmlFor={counterId} className="flex flex-col gap-1 text-small font-semibold">
          Loket / ruang pemanggil
          <select
            id={counterId}
            value={counter}
            onChange={(e) => chooseCounter(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] font-normal"
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        {canCall && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() => run(() => issueTicketAction({ serviceId: selected.id }))}
            >
              <Icon name="plus" size={16} strokeWidth={2.2} /> Ambil nomor baru
            </Button>
            <Button
              variant="primary"
              disabled={pending || !next}
              onClick={() => run(() => callNextAction({ serviceId: selected.id, counter }))}
            >
              <Icon name="bell" size={16} strokeWidth={2.2} />
              {next ? `Panggil berikutnya · ${next.queueNo}` : 'Tidak ada yang menunggu'}
            </Button>
          </span>
        )}
        {result && (
          <p
            role="status"
            className={cx(
              'm-0 flex w-full items-center gap-2 text-small font-semibold',
              result.ok ? 'text-success' : 'text-danger',
            )}
          >
            <Icon name={result.ok ? 'check' : 'alert'} size={16} strokeWidth={2.2} />
            {result.message}
          </p>
        )}
        {!canCall && (
          <p className="m-0 w-full text-small text-ink-700">
            Peran Anda hanya dapat melihat antrean; memanggil butuh izin panggil antrean.
          </p>
        )}
      </section>

      {section('Dipanggil dan dilayani', g.active, 'Belum ada nomor yang dipanggil.')}
      {section('Menunggu', g.waiting, 'Tidak ada nomor yang menunggu.')}
      {section('Dilewati', g.skipped, 'Tidak ada nomor yang dilewati.')}
      {section('Selesai', g.closed, 'Belum ada yang selesai hari ini.')}
    </div>
  );
}
