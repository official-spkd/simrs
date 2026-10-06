import 'server-only';
import type { PractitionerQuota, QueueBoard, RegistrationDesk, WeeklySchedule } from '@simrs/shared';
import {
  counterTickets,
  demoQueueBoard,
  demoRegistrationDesk,
  demoWeeklySchedule,
  type FrontOfficeProgress,
  NO_PROGRESS,
  SCENARIO_RJ,
  todayQuotas,
} from '../../../demo/fixtures/front-office';
import { DEMO_TODAY } from '../../../demo/fixtures/waktu';
import { nextQueueNo, parseQueueNo } from '../../../front-office';
import {
  applyQueueBoard,
  type LoketView,
  loketView,
  type QueueStoreState,
  takenLoketNos,
} from '../../../front-office-antrean';
import { applyScheduleStore, type ScheduleStoreState } from '../../../front-office-jadwal';
import { bookedBySession, type RegistrationState } from '../../../front-office-pendaftaran';
import type { SessionView } from '../../../session-view';
import type { EventOf } from '../../../demo/store/registry';
import { commitEvent, readDomain } from '../../demo/state';
import { assertDemo } from '../../demo-guard';
import { demoProgress } from './shared';

/**
 * Front office mode presentasi di atas toko demo bersama (ADR-0085): fixture (+ kemajuan skenario rawat jalan) lalu
 * keadaan domain `jadwal`, `pendaftaran`, dan `antrean`. Satu jalur untuk halaman, Server Action (gerbang), dan
 * layar lain yang membaca jadwal/kuota/antrean (info publik).
 */

export interface FrontOfficeStore {
  progress: FrontOfficeProgress;
  registration: { state: RegistrationState; rev: number };
  queue: { state: QueueStoreState; rev: number };
  schedule: { state: ScheduleStoreState; rev: number };
}

/** Keadaan front office sesi ini. `progress` = NO_PROGRESS untuk layar yang tidak mengikuti skenario (info publik). */
export async function frontOfficeStore(
  session: SessionView,
  opts: { scenario?: boolean } = {},
): Promise<FrontOfficeStore> {
  assertDemo();
  const [progress, registration, queue, schedule] = await Promise.all([
    opts.scenario === false ? NO_PROGRESS : demoProgress(session),
    readDomain('pendaftaran'),
    readDomain('antrean'),
    readDomain('jadwal'),
  ]);
  return { progress, registration, queue, schedule };
}

/** Jadwal minggu demo setelah kuota/cuti (jadwal) dan booking kunjungan terdaftar (pendaftaran). */
export function scheduleOf(fo: FrontOfficeStore): WeeklySchedule {
  return applyScheduleStore(
    demoWeeklySchedule(fo.progress),
    fo.schedule.state,
    bookedBySession(fo.registration.state),
  );
}

/** Nomor antrean `no` dimajukan `by` nomor (PD-028 + 2 → PD-030). */
function bump(no: string, by: number): string {
  const p = parseQueueNo(no);
  return p && by > 0 ? `${p.code}-${String(p.n + by).padStart(3, '0')}` : no;
}

/** Kuota dokter hari ini dari jadwal yang sudah diterapkan; nomor poli berikutnya melewati kunjungan terdaftar. */
export function quotasOf(fo: FrontOfficeStore): PractitionerQuota[] {
  const visits = fo.registration.state.visits;
  return todayQuotas(scheduleOf(fo)).map((q) => ({
    ...q,
    nextQueueNo: bump(q.nextQueueNo, visits.filter((v) => v.doctorId === q.doctorId).length),
  }));
}

/** Nomor tiket skenario yang tidak boleh dipakai walk-in/anjungan lain. */
const RESERVED_LOKET = [SCENARIO_RJ.ticket];

/** Antrean loket pendaftaran (tiket fixture + anjungan, panggilan tersimpan). */
export function loketOf(fo: FrontOfficeStore): LoketView {
  const base = demoRegistrationDesk(fo.progress).counter;
  return loketView(base.tickets, base.waiting, RESERVED_LOKET, fo.queue.state);
}

/** Meja pendaftaran: antrean loket dan kuota hari ini setelah toko. */
export function deskOf(fo: FrontOfficeStore): RegistrationDesk {
  const loket = loketOf(fo);
  return {
    date: DEMO_TODAY,
    counter: { name: 'Loket 3', waiting: loket.waiting, tickets: loket.queue },
    quotas: quotasOf(fo),
  };
}

/** Papan antrean poli setelah kunjungan terdaftar dan panggilan tersimpan. */
export function boardOf(fo: FrontOfficeStore): QueueBoard & { calling: NonNullable<QueueBoard['calling']> } {
  return applyQueueBoard(demoQueueBoard(fo.progress), fo.queue.state);
}

/** Satu panggilan di papan TV (panel besar + riwayat). */
export interface DisplayCall {
  queueNo: string;
  /** "Poli Penyakit Dalam" atau "Loket pendaftaran". */
  place: string;
  /** "Ruang 2 · dr. …" atau "Loket 3 · Lantai 1". */
  room: string;
}

/**
 * Papan TV: kartu poli setelah toko + linimasa panggilan (fixture pagi ini lalu panggilan tersimpan, termasuk
 * panggilan loket pendaftaran) untuk panel "SEDANG DIPANGGIL" dan riwayat.
 */
export function displayOf(fo: FrontOfficeStore): {
  board: ReturnType<typeof boardOf>;
  calling: DisplayCall;
  history: DisplayCall[];
  loket: { current: string | null; waiting: string[] };
} {
  const base = demoQueueBoard(fo.progress);
  const board = boardOf(fo);
  const meta = new Map(board.clinics.map((c) => [c.poliCode, c]));
  const poli = (queueNo: string, poliCode: string): DisplayCall => {
    const c = meta.get(poliCode);
    return {
      queueNo,
      place: c ? `Poli ${c.poliName}` : poliCode,
      room: c ? `${c.room} · ${c.doctorName}` : '',
    };
  };
  const timeline: DisplayCall[] = [
    ...[...base.history].reverse().map((h) => poli(h.queueNo, h.poliCode)),
    poli(base.calling.queueNo, base.calling.poliCode),
    ...fo.queue.state.calls.map((c) =>
      c.kind === 'poli' && c.poliCode
        ? poli(c.queueNo, c.poliCode)
        : { queueNo: c.queueNo, place: 'Loket pendaftaran', room: `${c.place ?? 'Loket'} · Lantai 1` },
    ),
  ];
  const loket = loketOf(fo);
  return {
    board,
    calling: timeline.at(-1) ?? poli(base.calling.queueNo, base.calling.poliCode),
    history: timeline.slice(-5, -1).reverse(),
    loket: { current: loket.current?.ticketNo ?? null, waiting: loket.queue.map((t) => t.ticket) },
  };
}

type FrontOfficeDomain = 'pendaftaran' | 'antrean' | 'jadwal';
const DOMAIN_KEY = { pendaftaran: 'registration', antrean: 'queue', jadwal: 'schedule' } as const;

/**
 * Catat kejadian yang isinya dihitung server dari keadaan TERKINI (nomor tiket anjungan, panggilan papan
 * berikutnya), bukan dari tampilan klien: baca keadaan, bangun kejadian, catat dengan revisi yang baru dibaca; bila
 * kalah balapan dengan perangkat lain (basi), ulangi sampai 3 kali. `build` mengembalikan galat gerbang (string)
 * atau kejadian.
 */
export async function commitFresh<N extends FrontOfficeDomain>(
  session: SessionView,
  name: N,
  build: (fo: FrontOfficeStore) => EventOf<N> | string,
): Promise<{ ok: true; event: EventOf<N> } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const fo = await frontOfficeStore(session);
    const event = build(fo);
    if (typeof event === 'string') return { ok: false, error: event };
    const r = await commitEvent(name, event, { rev: fo[DOMAIN_KEY[name]].rev, session });
    if (r.ok) return { ok: true, event };
    if (!r.stale) return { ok: false, error: r.error };
  }
  return { ok: false, error: 'Antrean sedang sibuk. Coba lagi sebentar.' };
}

/** Nomor tiket anjungan berikutnya per layanan (dihitung server saat cetak). */
export function nextKioskTicket(fo: FrontOfficeStore, service: 'loket' | 'farmasi'): string {
  const s = fo.queue.state;
  if (service === 'farmasi') {
    // Farmasi rawat jalan: F-020 terakhir dipanggil pagi ini (fixture info publik F-018 dilayani, F-021 berikutnya).
    return nextQueueNo('F', ['F-020', ...s.tickets.filter((t) => t.service === 'farmasi').map((t) => t.no)]);
  }
  return nextQueueNo('A', takenLoketNos(counterTickets(fo.progress), RESERVED_LOKET, s));
}
