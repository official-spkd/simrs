'use client';

import {
  APPOINTMENT_STATUS_LABEL,
  formatJam,
  formatTanggal,
  type PublicQueue,
  type PublicSchedule,
  toWallClock,
} from '@simrs/shared';
import { Alert, Button, Chip, cx, TabList } from '@simrs/ui';
import { useState } from 'react';
import { PhoneFrame } from '@/components/manajemen/phone-frame';
import { Stamp } from '@/components/platform/parts';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  type LookupResult,
  lookupBooking,
  MAX_ATTEMPTS,
  type PublicBookingRecord,
  quotaTone,
} from '@/lib/info-publik';

const TABS = [
  { id: 'jadwal', label: 'Jadwal' },
  { id: 'antrean', label: 'Antrean' },
  { id: 'cek', label: 'Cek booking' },
];
const day = (iso: string) => formatTanggal(`${iso}T12:00:00+07:00`);

function ScheduleTab({ schedule }: { schedule: PublicSchedule }) {
  const polis = [...new Set(schedule.sessions.map((s) => s.poliName))];
  const [poli, setPoli] = useState(polis[0] ?? '');
  const list = schedule.sessions.filter((s) => s.poliName === poli);
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[12.5px] text-ink-500">{day(schedule.date)} · sisa kuota per sesi</span>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Poli</span>
        <select
          value={poli}
          onChange={(e) => setPoli(e.target.value)}
          className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
        >
          {polis.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <ul aria-label="Jadwal dokter hari ini" className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((s) => (
          <li
            key={`${s.practitionerName}-${s.start}`}
            className="rounded-[12px] border border-white/95 bg-white/90 p-2.5 shadow-[0_2px_8px_rgba(23,32,46,0.06)]"
          >
            <span className="block text-[13.5px] font-semibold">{s.practitionerName}</span>
            <span className="block font-mono text-[12.5px] text-ink-500">
              {toWallClock(s.start)}–{toWallClock(s.end)}
            </span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <Chip tone={quotaTone(s.remaining.jkn)}>
                {s.remaining.jkn ? `JKN sisa ${s.remaining.jkn}` : 'JKN penuh'}
              </Chip>
              <Chip tone={quotaTone(s.remaining.nonJkn)}>
                {s.remaining.nonJkn ? `Umum sisa ${s.remaining.nonJkn}` : 'Umum penuh'}
              </Chip>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueTab({ queue }: { queue: PublicQueue }) {
  return (
    <ul aria-label="Antrean berjalan" className="m-0 flex list-none flex-col gap-2 p-0">
      {queue.services.map((s) => (
        <li
          key={s.code}
          className="flex items-center justify-between gap-2 rounded-[12px] border border-white/95 bg-white/90 p-2.5 shadow-[0_2px_8px_rgba(23,32,46,0.06)]"
        >
          <span className="flex flex-col">
            <span className="text-[13.5px] font-semibold">{s.name}</span>
            <span className="text-[12.5px] text-ink-500">
              {s.waiting} menunggu · ±{s.estimatedWaitMinutes} menit
            </span>
          </span>
          <span className="flex flex-col items-end">
            <span className="text-[11px] text-ink-500">dilayani</span>
            <span className="font-mono text-[18px] font-semibold text-brand-700">{s.current ?? '–'}</span>
          </span>
        </li>
      ))}
      <li className="text-[12px] text-ink-500">
        Diperbarui {formatJam(queue.asOf)} · hanya nomor, tanpa nama
      </li>
    </ul>
  );
}

function BookingTab({
  records,
  hint,
}: {
  records: PublicBookingRecord[];
  hint: { code: string; birthDate: string };
}) {
  const [code, setCode] = useState(hint.code);
  const [birth, setBirth] = useState('');
  const [failures, setFailures] = useState(0);
  const [result, setResult] = useState<(LookupResult & { t: string }) | null>(null);
  const blocked = failures >= MAX_ATTEMPTS;
  const check = () => {
    const r = lookupBooking(records, code, birth, failures);
    if (r.kind === 'not-found') setFailures((n) => n + 1);
    if (r.kind === 'found') setFailures(0);
    setResult({ ...r, t: formatJam(demoNow()) });
  };
  return (
    <form
      aria-label="Cek status booking"
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        check();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Kode booking (10 digit)</span>
        <input
          value={code}
          inputMode="numeric"
          onChange={(e) => setCode(e.target.value)}
          className="h-11 rounded-control border border-line-strong px-3 font-mono"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Tanggal lahir pasien</span>
        <input
          type="date"
          value={birth}
          onChange={(e) => setBirth(e.target.value)}
          className="h-11 rounded-control border border-line-strong px-3 font-[inherit]"
        />
      </label>
      <Button
        type="submit"
        variant="primary"
        disabled={blocked}
        aria-describedby={blocked ? 'cek-blok' : undefined}
      >
        Cek status
      </Button>
      {blocked && (
        <span id="cek-blok" className="text-[12.5px] font-medium text-danger">
          Terlalu banyak percobaan. Coba lagi 1 menit lagi.
        </span>
      )}
      {result?.kind === 'invalid' && <Alert level="warning">{result.message}</Alert>}
      {result?.kind === 'not-found' && (
        <Alert level="critical" title="Data tidak cocok">
          Periksa kode booking dan tanggal lahir. Sisa {result.attemptsLeft} percobaan dalam 1 menit.
        </Alert>
      )}
      {result?.kind === 'blocked' && (
        <Alert level="critical" title="Diblok sementara">
          Terlalu banyak percobaan dari perangkat ini.
        </Alert>
      )}
      {result?.kind === 'found' && (
        <section
          aria-label="Status booking"
          className="flex flex-col gap-1 rounded-[12px] border border-success-border bg-alert-success p-2.5 text-[13px]"
        >
          <span className="flex items-center justify-between gap-2">
            <b>Booking ditemukan</b>
            <Chip tone="success">{APPOINTMENT_STATUS_LABEL[result.booking.status]}</Chip>
          </span>
          <span>
            {day(result.booking.serviceDate)} · sesi {toWallClock(result.booking.start)}
          </span>
          <span>
            {result.booking.poliName} · {result.booking.practitionerName}
          </span>
          <span>
            Nomor Anda <b className="font-mono">{result.booking.queueNo ?? '–'}</b>
            {result.booking.currentQueueNo && (
              <>
                {' '}
                · sedang dilayani <b className="font-mono">{result.booking.currentQueueNo}</b>
              </>
            )}
          </span>
          {result.booking.estimatedAt && (
            <span>Perkiraan dipanggil {formatJam(result.booking.estimatedAt)}</span>
          )}
          <span>
            <Stamp>Dicek · {result.t}</Stamp>
          </span>
        </section>
      )}
    </form>
  );
}

/**
 * F08 · Pratinjau portal informasi publik di ponsel (tanpa login): jadwal + sisa kuota, antrean berjalan, cek
 * booking (kode + tanggal lahir, maks. 5 percobaan/menit, tanpa nama pasien), dan aturan halaman publik.
 */
export function PublicPortal({
  rsName,
  schedule,
  queue,
  bookings,
  hint,
}: {
  rsName: string;
  schedule: PublicSchedule;
  queue: PublicQueue;
  bookings: PublicBookingRecord[];
  hint: { code: string; birthDate: string };
}) {
  const [tab, setTab] = useState('jadwal');
  return (
    <div className="flex h-full w-full gap-8">
      <div className="h-full w-[390px] flex-none">
        <PhoneFrame time="10.45">
          <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-1 pb-2">
            <span className="flex flex-col">
              <h1 className="m-0 text-[20px] font-bold tracking-[-0.02em]">{rsName}</h1>
              <span className="text-[12.5px] text-ink-500">Info layanan publik</span>
            </span>
            <Chip tone="brand">tanpa login</Chip>
          </header>
          <div className="px-4 pb-2">
            <TabList items={TABS} value={tab} onChange={setTab} label="Menu info publik" variant="garis" />
          </div>
          <main className={cx('flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3')}>
            {tab === 'jadwal' && <ScheduleTab schedule={schedule} />}
            {tab === 'antrean' && <QueueTab queue={queue} />}
            {tab === 'cek' && <BookingTab records={bookings} hint={hint} />}
          </main>
        </PhoneFrame>
      </div>
      <aside
        aria-label="Aturan halaman publik"
        className="flex flex-1 flex-col gap-3 self-start rounded-card border border-white/95 bg-white/90 shadow-card p-5 text-[14px]"
      >
        <h2 className="m-0 text-[17px] font-semibold">Aturan halaman publik (F08)</h2>
        <p className="m-0 flex flex-wrap items-center gap-2">
          <Chip tone="success">Tanpa data medis</Chip> Hanya jadwal, sisa kuota, nomor antrean, dan status
          booking.
        </p>
        <p className="m-0 flex flex-wrap items-center gap-2">
          <Chip tone="info">Tanpa nama</Chip> Nama pasien tidak pernah dikirim ke portal.
        </p>
        <p className="m-0 flex flex-wrap items-center gap-2">
          <Chip tone="warning">Batas percobaan</Chip> {MAX_ATTEMPTS}× per menit; kode salah dan tanggal lahir
          salah dijawab sama.
        </p>
        <p className="m-0 text-ink-700">
          Coba: kode <span className="font-mono">{hint.code}</span> dengan tanggal lahir{' '}
          <span className="font-mono">{hint.birthDate}</span> (pasien fiktif). Tanggal lain menampilkan “Data
          tidak cocok”.
        </p>
      </aside>
    </div>
  );
}
