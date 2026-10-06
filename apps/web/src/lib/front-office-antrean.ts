import {
  type CounterTicket,
  QUEUE_NO_PATTERN,
  type QueueBoard,
  type QueueBoardClinic,
  wallClockSchema,
} from '@simrs/shared';
import { z } from 'zod';
import { defineDomain, on } from './demo/store/define';
import { nextQueueNo } from './front-office';
import { registrationDomain } from './front-office-pendaftaran';

/**
 * F04/F05 · Domain toko demo `antrean` (ADR-0085): tiket anjungan, panggilan loket pendaftaran, panggilan poli di
 * papan TV, dan permintaan bantuan anjungan (mode presentasi). Melanggan `pendaftaran` (`kunjungan.terdaftar`):
 * nomor poli pasien baru masuk "Berikutnya" di papan TV dan tiket loketnya selesai.
 *
 * Kejadian `antrean.dipanggil` adalah KONTRAK keluar untuk Poli (CD-2): nomor poli yang dipanggil ke ruang periksa
 * dari papan antrean (`via: 'display'`). Nomor dan urutan panggilan dihitung server (Server Action), bukan klien.
 */

export const QUEUE_DOMAIN = 'antrean';

const queueNo = z.string().regex(QUEUE_NO_PATTERN);

export const TICKET_PURPOSES = ['booking', 'kontrol', 'umum', 'farmasi'] as const;
export type TicketPurpose = (typeof TICKET_PURPOSES)[number];

export const queueEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Tiket anjungan tercetak (nomor dihitung server: nomor bebas berikutnya). */
    type: z.literal('tiket.diambil'),
    ticketNo: queueNo,
    service: z.enum(['loket', 'farmasi']),
    purpose: z.enum(TICKET_PURPOSES),
    /** Pasien yang teridentifikasi di anjungan (booking/kontrol), null untuk walk-in tanpa identitas. */
    patientId: z.string().min(1).max(60).nullable(),
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** Tiket loket dipanggil ke loket pendaftaran. */
    type: z.literal('tiket.dipanggil'),
    ticketNo: queueNo,
    counter: z.string().min(1).max(40),
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** Nomor poli dipanggil ke ruang periksa (papan TV / petugas poli). */
    type: z.literal('antrean.dipanggil'),
    queueNo,
    poliCode: z.string().regex(/^[A-Z]{2}$/),
    via: z.enum(['display', 'poli']),
    jam: wallClockSchema,
  }),
  z.strictObject({
    /** "Panggil petugas" di anjungan: petugas pendaftaran melihat permintaan (tanpa data pasien). */
    type: z.literal('bantuan.diminta'),
    device: z.string().min(1).max(60),
    jam: wallClockSchema,
  }),
  z.strictObject({
    type: z.literal('bantuan.ditangani'),
    jam: wallClockSchema,
  }),
]);
export type QueueEvent = z.infer<typeof queueEventSchema>;

export interface StoredTicket {
  no: string;
  service: 'loket' | 'farmasi';
  purpose: TicketPurpose;
  patientId: string | null;
  jam: string;
  seq: number;
}

export interface QueueCallRecord {
  kind: 'loket' | 'poli';
  queueNo: string;
  /** Kode poli (panggilan poli) atau null (loket). */
  poliCode: string | null;
  /** Loket/ruang tujuan, mis. "Loket 3". */
  place: string | null;
  jam: string;
  seq: number;
  by: string;
}

export interface RegisteredQueue {
  queueNo: string;
  poliCode: string;
  doctorName: string;
  room: string;
  patientId: string;
  ticketNo: string | null;
  seq: number;
}

export interface QueueStoreState {
  tickets: readonly StoredTicket[];
  calls: readonly QueueCallRecord[];
  /** Nomor poli dari kunjungan terdaftar (langganan `pendaftaran`). */
  registered: readonly RegisteredQueue[];
  /** Permintaan bantuan anjungan yang belum ditangani. */
  assist: { device: string; jam: string; seq: number } | null;
}

const called = (s: QueueStoreState, no: string) => s.calls.some((c) => c.queueNo === no);

function gate(s: QueueStoreState, ev: QueueEvent): string | null {
  switch (ev.type) {
    case 'tiket.diambil': {
      if (s.tickets.some((t) => t.no === ev.ticketNo) || called(s, ev.ticketNo)) {
        return `Nomor ${ev.ticketNo} sudah dipakai.`;
      }
      if (!ev.patientId) return null;
      if (ev.service === 'loket') {
        const reg = s.registered.find((r) => r.patientId === ev.patientId);
        if (reg) return `Anda sudah terdaftar hari ini. Nomor antrean poli Anda ${reg.queueNo}.`;
      }
      const prev = s.tickets.find((t) => t.patientId === ev.patientId && t.service === ev.service);
      return prev ? `Anda sudah check-in. Nomor antrean Anda ${prev.no}.` : null;
    }
    case 'tiket.dipanggil':
      return called(s, ev.ticketNo) ? `Tiket ${ev.ticketNo} sudah dipanggil.` : null;
    case 'antrean.dipanggil':
      return called(s, ev.queueNo) ? `Nomor ${ev.queueNo} sudah dipanggil.` : null;
    case 'bantuan.diminta':
      return s.assist ? 'Petugas sudah dipanggil dan sedang menuju anjungan.' : null;
    case 'bantuan.ditangani':
      return s.assist ? null : 'Tidak ada permintaan bantuan yang terbuka.';
  }
}

export const queueDomain = defineDomain<QueueStoreState, QueueEvent>(QUEUE_DOMAIN, {
  initial: () => ({ tickets: [], calls: [], registered: [], assist: null }),
  eventSchema: queueEventSchema,
  screens: ['kiosk', 'antrean', 'daftar', 'info-publik'],
  validate: (s, ev) => gate(s, ev),
  subscriptions: [
    on(registrationDomain, (s: QueueStoreState, ev) => {
      const d = ev.data;
      if (d.type !== 'kunjungan.terdaftar') return s;
      return {
        ...s,
        registered: [
          ...s.registered,
          {
            queueNo: d.queueNo,
            poliCode: d.poliCode,
            doctorName: d.doctorName,
            room: d.room,
            patientId: d.patientId,
            ticketNo: d.ticketNo,
            seq: ev.seq,
          },
        ],
      };
    }),
  ],
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    switch (d.type) {
      case 'tiket.diambil':
        return {
          ...s,
          tickets: [
            ...s.tickets,
            {
              no: d.ticketNo,
              service: d.service,
              purpose: d.purpose,
              patientId: d.patientId,
              jam: d.jam,
              seq: ev.seq,
            },
          ],
        };
      case 'tiket.dipanggil':
        return {
          ...s,
          calls: [
            ...s.calls,
            {
              kind: 'loket',
              queueNo: d.ticketNo,
              poliCode: null,
              place: d.counter,
              jam: d.jam,
              seq: ev.seq,
              by: ev.actor.name,
            },
          ],
        };
      case 'antrean.dipanggil':
        return {
          ...s,
          calls: [
            ...s.calls,
            {
              kind: 'poli',
              queueNo: d.queueNo,
              poliCode: d.poliCode,
              place: null,
              jam: d.jam,
              seq: ev.seq,
              by: ev.actor.name,
            },
          ],
        };
      case 'bantuan.diminta':
        return { ...s, assist: { device: d.device, jam: d.jam, seq: ev.seq } };
      case 'bantuan.ditangani':
        return { ...s, assist: null };
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Loket pendaftaran
// ---------------------------------------------------------------------------------------------------------------

export interface LoketView {
  /** Tiket menunggu, urut panggil: tiket booking anjungan (beridentitas) dulu, lalu walk-in. */
  queue: CounterTicket[];
  /** Tiket terakhir yang dipanggil ke loket (sedang dilayani), null bila belum ada. */
  current: { ticketNo: string; patientId: string | null; place: string; jam: string } | null;
  /** Nomor tiket loket berikutnya yang akan dipanggil (walk-in baru bila antrean kosong). */
  next: string;
  /** Jumlah menunggu (termasuk walk-in tanpa tiket di layar). */
  waiting: number;
}

/** Semua nomor loket yang sudah dipakai: tiket fixture, nomor dicadangkan, tiket anjungan, dan panggilan. */
export function takenLoketNos(
  fixture: readonly CounterTicket[],
  reserved: readonly string[],
  s: QueueStoreState,
): string[] {
  return [
    ...fixture.map((t) => t.ticket),
    ...reserved,
    ...s.tickets.filter((t) => t.service === 'loket').map((t) => t.no),
    ...s.calls.filter((c) => c.kind === 'loket').map((c) => c.queueNo),
  ];
}

/**
 * Antrean loket pendaftaran setelah keadaan toko. `fixture` = tiket loket fixture (walk-in + pasien skenario bila
 * belum dipanggil), `baseWaiting` = jumlah menunggu fixture (termasuk walk-in di luar layar), `reserved` = nomor yang
 * tidak boleh dipakai walk-in baru (tiket skenario).
 */
export function loketView(
  fixture: readonly CounterTicket[],
  baseWaiting: number,
  reserved: readonly string[],
  s: QueueStoreState,
): LoketView {
  const store = s.tickets
    .filter((t) => t.service === 'loket' && !called(s, t.no))
    .map((t) => ({ ticket: t.no, patientId: t.patientId }));
  const booked = store.filter((t) => t.patientId !== null);
  const walk = [
    ...fixture.filter((t) => !called(s, t.ticket) && !reserved.includes(t.ticket)),
    ...store.filter((t) => t.patientId === null),
  ];
  const queue = [...booked, ...walk];
  const loketCalls = s.calls.filter((c) => c.kind === 'loket');
  const last = loketCalls.at(-1);
  const ticketOf = (no: string) =>
    s.tickets.find((t) => t.no === no)?.patientId ?? fixture.find((t) => t.ticket === no)?.patientId ?? null;
  const added = s.tickets.filter((t) => t.service === 'loket').length;
  return {
    queue,
    current: last
      ? { ticketNo: last.queueNo, patientId: ticketOf(last.queueNo), place: last.place ?? '', jam: last.jam }
      : null,
    next: queue[0]?.ticket ?? nextQueueNo('A', takenLoketNos(fixture, reserved, s)),
    waiting: Math.max(0, baseWaiting + added - loketCalls.length),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Papan antrean poli (TV)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Papan setelah keadaan toko: nomor kunjungan baru masuk antrean kartu poli dokter yang sama (urut nomor), lalu
 * panggilan poli diterapkan berurutan (nomor dipanggil menjadi "dilayani" dan "SEDANG DIPANGGIL").
 */
export function applyQueueBoard<B extends QueueBoard>(board: B, s: QueueStoreState): B {
  let clinics: QueueBoardClinic[] = board.clinics.map((c) => {
    const add = s.registered
      .filter((r) => r.poliCode === c.poliCode && r.doctorName === c.doctorName)
      .map((r) => r.queueNo)
      .filter((no) => !c.waiting.includes(no) && c.current !== no);
    return add.length ? { ...c, waiting: [...c.waiting, ...add].sort() } : c;
  });
  let calling = board.calling;
  let history = board.history;
  for (const call of s.calls) {
    if (call.kind !== 'poli' || !call.poliCode) continue;
    const i = clinics.findIndex((c) => c.poliCode === call.poliCode);
    if (i < 0) continue;
    clinics = clinics.map((c, j) =>
      j === i ? { ...c, current: call.queueNo, waiting: c.waiting.filter((n) => n !== call.queueNo) } : c,
    );
    if (calling) history = [calling, ...history].slice(0, 4);
    calling = { queueNo: call.queueNo, poliCode: call.poliCode };
  }
  return { ...board, clinics, calling, history };
}

/**
 * Panggilan poli berikutnya: poli sesudah poli yang terakhir memanggil (bergiliran), nomor terdepan yang tidak
 * dicadangkan untuk petugas poli. Null bila semua antrean kosong (antrean tidak ditambah otomatis).
 */
export function nextPoliCall(board: QueueBoard): { queueNo: string; poliCode: string } | null {
  const n = board.clinics.length;
  const from = board.clinics.findIndex((c) => c.poliCode === board.calling?.poliCode);
  for (let k = 1; k <= n; k++) {
    const c = board.clinics[(from + k + n) % n];
    const head = c?.waiting[0];
    if (c && head && !c.reserved.includes(head)) return { queueNo: head, poliCode: c.poliCode };
  }
  return null;
}

/** Panggilan terakhir (loket atau poli) untuk panel besar papan TV; null bila belum ada panggilan di toko. */
export function lastCall(s: QueueStoreState): QueueCallRecord | null {
  return s.calls.at(-1) ?? null;
}
