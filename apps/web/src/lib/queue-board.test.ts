import { type QueueBoard, type QueueTicket, queueBoardSchema } from '@simrs/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  applyQueueEvent,
  callAnnouncement,
  counterOptions,
  groupTickets,
  nextCallable,
  spokenQueueNo,
  ticketActions,
} from './queue-board';
import { connectQueueStream, type EventSourceLike } from './queue-sse';

const board: QueueBoard = {
  area: 'Rawat Jalan Lantai 2',
  asOf: '2026-10-05T08:00:00+07:00',
  calling: { queueNo: 'PD-003', poliCode: 'PD' },
  history: [
    { queueNo: 'JT-002', poliCode: 'JT' },
    { queueNo: 'PD-002', poliCode: 'PD' },
  ],
  clinics: [
    {
      poliCode: 'PD',
      poliName: 'Penyakit Dalam',
      room: 'Ruang 2',
      doctorName: 'dr. Fiktif, Sp.PD',
      current: 'PD-003',
      waiting: ['PD-004', 'PD-005'],
      reserved: ['PD-007'],
      note: 'Sesuai jadwal',
      noteTone: 'normal',
    },
    {
      poliCode: 'JT',
      poliName: 'Jantung',
      room: 'Ruang 4',
      doctorName: 'dr. Fiktif, Sp.JP',
      current: 'JT-002',
      waiting: ['JT-003'],
      reserved: [],
      note: 'Sesuai jadwal',
      noteTone: 'normal',
    },
  ],
  info: 'Info',
};

const call = (queueNo: string, serviceCode: string, recall = false) =>
  ({
    type: 'call',
    callId: '01a107db-b268-746d-92f7-10598bb1cc42',
    queueNo,
    serviceCode,
    counter: 'Ruang 2',
    recall,
    at: '2026-10-05T08:05:00+07:00',
  }) as const;

describe('papan antrean TV: event SSE', () => {
  it('panggilan: SEDANG DIPANGGIL, riwayat terbaru dulu, nomor keluar dari tunggu dan jadi dilayani', () => {
    const b = applyQueueEvent(board, call('PD-004', 'PD'));
    expect(b.calling).toEqual({ queueNo: 'PD-004', poliCode: 'PD' });
    expect(b.history.map((h) => h.queueNo)).toEqual(['PD-003', 'JT-002', 'PD-002']);
    expect(b.clinics[0]).toMatchObject({ current: 'PD-004', waiting: ['PD-005'] });
    expect(b.clinics[1]).toEqual(board.clinics[1]);
    expect(b.asOf).toBe('2026-10-05T08:05:00+07:00');
    expect(() => queueBoardSchema.parse(b)).not.toThrow();
  });

  it('nomor cadangan booking yang dipanggil petugas poli keluar dari daftar cadangan', () => {
    expect(applyQueueEvent(board, call('PD-007', 'PD')).clinics[0]?.reserved).toEqual([]);
  });

  it('panggil ulang nomor yang sedang dipanggil tidak menggandakan riwayat; panggil ulang nomor lama memindahkannya', () => {
    expect(applyQueueEvent(board, call('PD-003', 'PD', true)).history).toEqual(board.history);
    const b = applyQueueEvent(board, call('PD-002', 'PD', true));
    expect(b.calling?.queueNo).toBe('PD-002');
    expect(b.history.map((h) => h.queueNo)).toEqual(['PD-003', 'JT-002']);
  });

  it('riwayat maksimal 4; papan tanpa panggilan sebelumnya; potret board menggantikan papan', () => {
    let b: QueueBoard = { ...board, calling: null, history: [] };
    for (const no of ['PD-004', 'PD-005', 'JT-003', 'PD-006', 'PD-008', 'PD-009']) {
      b = applyQueueEvent(b, call(no, no.slice(0, 2)));
    }
    expect(b.history).toHaveLength(4);
    expect(b.history[0]?.queueNo).toBe('PD-008');
    const fresh = { ...board, area: 'Lantai 3' };
    expect(applyQueueEvent(b, { type: 'board', board: fresh })).toBe(fresh);
  });

  it('suara panggilan: huruf dieja, angka per digit, tanpa "minus"', () => {
    expect(spokenQueueNo('PD-027')).toBe('P D, nol dua tujuh');
    expect(spokenQueueNo('A-105')).toBe('A, satu nol lima');
    expect(callAnnouncement({ queueNo: 'PD-027', counter: 'Ruang 2', recall: false })).toBe(
      'Nomor antrean P D, nol dua tujuh, silakan menuju Ruang 2.',
    );
    expect(callAnnouncement({ queueNo: 'A-031', counter: 'Loket 3', recall: true })).toMatch(
      /^Panggilan ulang\. Nomor antrean A, nol tiga satu/,
    );
  });
});

const ticket = (queueNo: string, status: QueueTicket['status'], reserved = false): QueueTicket => ({
  id: `01a107db-b268-746d-92f7-${String(Number(queueNo.slice(-3))).padStart(12, '0')}`,
  serviceId: '01a107db-b650-7665-8612-3e74278ceafa',
  serviceCode: 'A',
  queueNo,
  serviceDate: '2026-10-05',
  status,
  source: 'loket',
  reserved,
  appointmentId: null,
  encounterId: null,
  patientId: null,
  issuedAt: '2026-10-05T07:00:00+07:00',
  calledAt: null,
  callCount: 0,
  counter: null,
  startedAt: null,
  finishedAt: null,
  estimatedCallAt: null,
});

describe('kendali antrean', () => {
  it('aksi per status sesuai transisi API', () => {
    expect(ticketActions('waiting')).toEqual(['call']);
    expect(ticketActions('called')).toEqual(['recall', 'start', 'skip']);
    expect(ticketActions('serving')).toEqual(['finish']);
    expect(ticketActions('skipped')).toEqual(['call']);
    expect(ticketActions('done')).toEqual([]);
    expect(ticketActions('cancelled')).toEqual([]);
  });

  it('kelompok tiket dan "panggil berikutnya" FIFO tanpa nomor cadangan', () => {
    const list = [
      ticket('A-004', 'waiting'),
      ticket('A-001', 'done'),
      ticket('A-002', 'called'),
      ticket('A-003', 'waiting', true),
      ticket('A-005', 'skipped'),
    ];
    const g = groupTickets(list);
    expect(g.active.map((t) => t.queueNo)).toEqual(['A-002']);
    expect(g.waiting.map((t) => t.queueNo)).toEqual(['A-003', 'A-004']);
    expect(g.skipped.map((t) => t.queueNo)).toEqual(['A-005']);
    expect(g.closed.map((t) => t.queueNo)).toEqual(['A-001']);
    expect(nextCallable(list)?.queueNo).toBe('A-004');
    expect(nextCallable([ticket('A-003', 'waiting', true)])).toBeNull();
  });

  it('pilihan loket per jenis layanan', () => {
    expect(counterOptions({ kind: 'loket', room: null, name: 'Loket pendaftaran' })[2]).toBe('Loket 3');
    expect(counterOptions({ kind: 'poli', room: 'Ruang 2', name: 'Penyakit Dalam' })).toEqual(['Ruang 2']);
    expect(counterOptions({ kind: 'poli', room: null, name: 'Penyakit Dalam' })).toEqual(['Penyakit Dalam']);
  });
});

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
    }
  }
  open() {
    this.readyState = 1;
    this.onopen?.call(this, new Event('open'));
  }
  fail(state: number) {
    this.readyState = state;
    this.onerror?.call(this, new Event('error'));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

describe('klien SSE papan antrean', () => {
  const setup = () => {
    FakeSource.all = [];
    const events: unknown[] = [];
    const statuses: string[] = [];
    const invalid: string[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const conn = connectQueueStream({
      url: '/display/antrean/events',
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      onInvalid: (r) => invalid.push(r),
      create: (url) => new FakeSource(url),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: vi.fn(),
    });
    return { conn, events, statuses, invalid, timers };
  };

  it('event board/call divalidasi kontrak; data rusak diabaikan', () => {
    const { events, statuses, invalid } = setup();
    const es = FakeSource.all[0];
    if (!es) throw new Error('EventSource');
    expect(es.url).toBe('/display/antrean/events');
    es.open();
    es.emit('queue.board', { type: 'board', board });
    es.emit('queue.call', call('PD-004', 'PD'));
    es.emit('queue.call', { type: 'call', queueNo: 'bukan nomor' });
    es.emit('queue.call', '{rusak');
    expect(events).toHaveLength(2);
    expect(invalid).toHaveLength(2);
    expect(statuses).toEqual(['menyambung', 'tersambung']);
  });

  it('reset: aliran lama ditutup, aliran baru dibuka (tanpa Last-Event-ID → potret papan baru)', () => {
    setup();
    const first = FakeSource.all[0];
    first?.emit('reset', { reason: 'replay_unavailable' });
    expect(first?.closed).toBe(true);
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[1]?.closed).toBe(false);
  });

  it('putus sementara: EventSource menyambung sendiri; tertutup permanen: dicoba lagi dengan jeda naik', () => {
    const { timers, statuses, conn } = setup();
    FakeSource.all[0]?.fail(0);
    expect(timers).toHaveLength(0);
    expect(FakeSource.all).toHaveLength(1);
    FakeSource.all[0]?.fail(2);
    expect(timers[0]?.ms).toBe(2000);
    timers[0]?.fn();
    expect(FakeSource.all).toHaveLength(2);
    FakeSource.all[1]?.fail(2);
    expect(timers[1]?.ms).toBe(4000);
    expect(statuses.filter((s) => s === 'terputus')).toHaveLength(3);
    conn.close();
    expect(FakeSource.all.every((s) => s.closed || s === FakeSource.all[2])).toBe(true);
  });
});
