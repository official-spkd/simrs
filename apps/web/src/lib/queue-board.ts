import type { QueueBoard, QueueDisplayEvent, QueueTicket, QueueTicketStatus } from '@simrs/shared';

/**
 * F04 · Logika murni papan antrean TV dan kendali antrean (fase 2 potongan 4b). Dipakai komponen klien display
 * (event SSE ADR-0026) dan halaman staf "Kendali antrean"; diuji tanpa browser.
 */

/** Batas riwayat panggilan di papan (sama dengan kontrak `queueBoardSchema.history`). */
export const BOARD_HISTORY_MAX = 4;

type Call = NonNullable<QueueBoard['calling']>;
const same = (a: Call | null | undefined, b: Call) =>
  !!a && a.queueNo === b.queueNo && a.poliCode === b.poliCode;

/**
 * Terapkan satu event display ke papan:
 * - `board` = potret lengkap dari server (saat tersambung, setelah replay, atau papan berubah tanpa panggilan);
 * - `call` = panggilan/panggil ulang: jadi "SEDANG DIPANGGIL", panggilan sebelumnya masuk riwayat (tanpa ganda),
 *   nomor itu menjadi "dilayani" di kartu poli-nya dan keluar dari daftar tunggu.
 */
export function applyQueueEvent(board: QueueBoard, ev: QueueDisplayEvent): QueueBoard {
  if (ev.type === 'board') return ev.board;
  const call: Call = { queueNo: ev.queueNo, poliCode: ev.serviceCode };
  const history = same(board.calling, call)
    ? board.history
    : [...(board.calling ? [board.calling] : []), ...board.history]
        .filter((h) => !same(h, call))
        .slice(0, BOARD_HISTORY_MAX);
  return {
    ...board,
    asOf: ev.at,
    calling: call,
    history,
    clinics: board.clinics.map((c) =>
      c.poliCode === ev.serviceCode
        ? {
            ...c,
            current: ev.queueNo,
            waiting: c.waiting.filter((n) => n !== ev.queueNo),
            reserved: c.reserved.filter((n) => n !== ev.queueNo),
          }
        : c,
    ),
  };
}

const DIGIT = [
  'nol',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
] as const;

/**
 * Nomor antrean untuk suara: huruf dieja dan angka dibaca per digit, seperti petugas memanggil (`PD-027` → "P D, nol
 * dua tujuh"). Tanda hubung tidak dibaca "minus".
 */
export function spokenQueueNo(queueNo: string): string {
  const [prefix = '', digits = ''] = queueNo.split('-');
  const letters = prefix.split('').join(' ');
  const numbers = digits
    .split('')
    .map((d) => DIGIT[Number(d)] ?? d)
    .join(' ');
  return numbers ? `${letters}, ${numbers}` : letters;
}

/** Kalimat panggilan TV (Web Speech id-ID). */
export function callAnnouncement(ev: { queueNo: string; counter: string; recall: boolean }): string {
  const lead = ev.recall ? 'Panggilan ulang. Nomor antrean' : 'Nomor antrean';
  return `${lead} ${spokenQueueNo(ev.queueNo)}, silakan menuju ${ev.counter}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Kendali antrean (staf)
// ---------------------------------------------------------------------------------------------------------------

/** Aksi tombol per tiket di Kendali antrean, urut tampil. Hanya `waiting` yang dipanggil lewat "Panggil berikutnya". */
export type TicketAction = 'call' | 'recall' | 'start' | 'skip' | 'finish';

export const TICKET_ACTION_LABEL: Record<TicketAction, string> = {
  call: 'Panggil',
  recall: 'Panggil ulang',
  start: 'Mulai layani',
  skip: 'Lewati',
  finish: 'Selesai',
};

/** Aksi yang sah untuk status tiket (aturan transisi sama dengan API; API tetap menegakkannya). */
export function ticketActions(status: QueueTicketStatus): TicketAction[] {
  switch (status) {
    case 'waiting':
      return ['call'];
    case 'called':
      return ['recall', 'start', 'skip'];
    case 'serving':
      return ['finish'];
    case 'skipped':
      return ['call'];
    default:
      return [];
  }
}

/** Kelompok tampilan Kendali: sedang dilayani di atas, lalu menunggu (FIFO), dilewati, selesai/batal. */
export function groupTickets(tickets: readonly QueueTicket[]): {
  active: QueueTicket[];
  waiting: QueueTicket[];
  skipped: QueueTicket[];
  closed: QueueTicket[];
} {
  const by = (s: readonly QueueTicketStatus[]) => tickets.filter((t) => s.includes(t.status));
  const byNo = (a: QueueTicket, b: QueueTicket) => a.queueNo.localeCompare(b.queueNo);
  return {
    active: by(['called', 'serving']).sort(byNo),
    waiting: by(['waiting']).sort(byNo),
    skipped: by(['skipped']).sort(byNo),
    closed: by(['done', 'cancelled']).sort(byNo),
  };
}

/** Nomor yang akan dipanggil "Panggil berikutnya" (FIFO, tanpa nomor cadangan booking), null bila kosong. */
export function nextCallable(tickets: readonly QueueTicket[]): QueueTicket | null {
  return groupTickets(tickets).waiting.find((t) => !t.reserved) ?? null;
}

/** Pilihan loket/ruang pemanggil per jenis layanan (tampil di TV dan disebut suara panggilan). */
export function counterOptions(service: { kind: string; room: string | null; name: string }): string[] {
  switch (service.kind) {
    case 'loket':
      return Array.from({ length: 6 }, (_, i) => `Loket ${i + 1}`);
    case 'farmasi':
      return ['Loket Farmasi 1', 'Loket Farmasi 2', 'Loket Farmasi 3'];
    case 'kasir':
      return ['Kasir 1', 'Kasir 2', 'Kasir 3'];
    default:
      return [service.room ?? service.name];
  }
}
