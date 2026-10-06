import { sumRupiah } from '@simrs/shared';

/**
 * U02 · Charge capture monitor (mode presentasi, ADR-0023): event klinis → baris tagihan bersumber, pengecualian
 * eksplisit (tarif tidak ada, kelas belum ditetapkan, penjamin berubah), baris pembalik, dan koreksi beralasan.
 * Aturan (rencana fase 5 potongan 5.4): baris klinis hanya dikoreksi di unit asal; hanya baris manual yang bisa
 * dibatalkan kasir (alasan wajib). Murni; uang bigint.
 */

export type SumberEvent =
  'pendaftaran' | 'adt' | 'cppt' | 'cpoe' | 'emar' | 'lis' | 'ris' | 'farmasi' | 'ok' | 'kasir';

export const SUMBER_LABEL: Record<SumberEvent, string> = {
  pendaftaran: 'Pendaftaran',
  adt: 'ADT (kamar)',
  cppt: 'Visite (CPPT)',
  cpoe: 'Order (CPOE)',
  emar: 'eMAR',
  lis: 'Laboratorium',
  ris: 'Radiologi',
  farmasi: 'Farmasi',
  ok: 'Kamar operasi',
  kasir: 'Manual kasir',
};

export type StatusCapture = 'tertagih' | 'tertahan' | 'dibalik';

export type JenisTahan = 'tarif-tidak-ada' | 'kelas-belum-ada' | 'penjamin-berubah';

export interface BarisCapture {
  itemCode: string;
  name: string;
  qty: number;
  unitPrice: bigint;
  amount: bigint;
}

export interface EventCapture {
  id: string;
  at: string;
  source: SumberEvent;
  /** Nama event domain, mis. `lab.specimen_received`. */
  event: string;
  description: string;
  patient: { name: string; rm: string; place: string; payer: string };
  status: StatusCapture;
  /** Baris tagihan terbentuk (pembalik bernilai negatif); null bila tertahan. */
  line: BarisCapture | null;
  manual?: { by: string; reason: string };
  /** Event yang dibalik oleh baris ini. */
  reverses?: string;
  hold?: {
    kind: JenisTahan;
    reason: string;
    /** Baris yang akan terbentuk setelah ditangani (harga dari tarif yang baru disetujui / tarif penjamin baru). */
    resolution: BarisCapture | null;
    /** Tarif sudah disetujui (coba ulang tersedia). */
    tariffApprovedAt?: string;
    /** Penjamin berubah: baris terbuka yang perlu dibalik dan dibuat ulang dengan tarif penjamin baru. */
    reprice?: Array<{ before: BarisCapture; after: BarisCapture }>;
  };
}

export function line(itemCode: string, name: string, qty: number, unitPrice: bigint): BarisCapture {
  return { itemCode, name, qty, unitPrice, amount: unitPrice * BigInt(qty) };
}

/** Baris pembalik: kuantitas dan jumlah negatif. */
export function reversal(l: BarisCapture): BarisCapture {
  return { ...l, qty: -l.qty, amount: -l.amount };
}

/** Σ jumlah baris = Σ (kuantitas × harga satuan): sifat yang dijaga tes. */
export function lineConsistent(l: BarisCapture): boolean {
  return l.amount === l.unitPrice * BigInt(l.qty);
}

export function netCaptured(events: readonly EventCapture[]): bigint {
  return sumRupiah(events.flatMap((e) => (e.line && e.status !== 'tertahan' ? [e.line.amount] : [])));
}

export interface KunjunganCapture {
  key: string;
  patient: EventCapture['patient'];
  events: number;
  held: number;
  net: bigint;
}

/** Kelengkapan per kunjungan: finalisasi tagihan ditahan selama masih ada event tertahan (barrier). */
export function byEncounter(events: readonly EventCapture[]): KunjunganCapture[] {
  const map = new Map<string, KunjunganCapture>();
  for (const e of events) {
    const key = e.patient.rm;
    const cur = map.get(key) ?? { key, patient: e.patient, events: 0, held: 0, net: 0n };
    cur.events += 1;
    if (e.status === 'tertahan') cur.held += 1;
    else if (e.line) cur.net += e.line.amount;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.held - a.held || a.patient.name.localeCompare(b.patient.name));
}

/**
 * Rekonsiliasi capture: setiap event bisa-tagih menjadi baris bersumber atau pengecualian eksplisit — tidak ada event
 * yang hilang diam-diam. `unexplained` = event tanpa baris dan tanpa alasan tahan (harus nol).
 */
export function captureReconciliation(events: readonly EventCapture[]): {
  total: number;
  billed: number;
  held: number;
  reversed: number;
  unexplained: number;
} {
  return {
    total: events.length,
    billed: events.filter((e) => e.status === 'tertagih').length,
    held: events.filter((e) => e.status === 'tertahan').length,
    reversed: events.filter((e) => e.status === 'dibalik').length,
    unexplained: events.filter((e) => (e.status === 'tertahan' ? !e.hold : !e.line)).length,
  };
}

/** Tindakan yang tersedia untuk satu event (gerbang tombol; teks alasan bila nonaktif). */
export function captureActions(e: EventCapture): {
  retry: string | null;
  voidManual: string | null;
  correction: string | null;
} {
  const retry =
    e.status !== 'tertahan' || !e.hold
      ? 'Event sudah tertagih.'
      : e.hold.kind === 'tarif-tidak-ada' && !e.hold.tariffApprovedAt
        ? 'Tarif belum disetujui; minta tarif ke pengelola tarif dulu.'
        : e.hold.kind === 'kelas-belum-ada'
          ? 'Kelas rawat ditetapkan admisi di modul ADT, bukan di billing.'
          : null;
  const voidManual = !e.manual
    ? 'Baris klinis hanya dikoreksi di unit asal; billing tidak menghapus baris klinis.'
    : e.status !== 'tertagih'
      ? 'Baris sudah dibatalkan.'
      : null;
  const correction = e.manual || e.status !== 'tertagih' ? 'Hanya untuk baris klinis yang tertagih.' : null;
  return { retry, voidManual, correction };
}

/** Selesaikan event tertahan: baris dari resolusi (tarif baru/penjamin baru) dan status tertagih. */
export function resolveHold(e: EventCapture): EventCapture[] {
  if (e.status !== 'tertahan' || !e.hold) return [e];
  const resolved = e.hold.reprice ? repriceNetLine(e.hold.reprice) : e.hold.resolution;
  return [{ ...e, status: 'tertagih', line: resolved, hold: undefined }];
}

/**
 * Penjamin berubah: setiap baris terbuka dibalik lalu dibuat ulang dengan tarif penjamin baru; yang tersisa di
 * tagihan adalah selisih bersihnya (satu baris ringkas bersumber event `coverage.changed`).
 */
export function repriceNetLine(
  pairs: ReadonlyArray<{ before: BarisCapture; after: BarisCapture }>,
): BarisCapture {
  const net = sumRupiah(pairs.map((p) => p.after.amount - p.before.amount));
  return line(
    'REPRICE',
    `Selisih tarif penjamin baru (${pairs.length} baris dibalik dan dibuat ulang)`,
    1,
    net,
  );
}

/** Batalkan baris manual: event asal ditandai dibalik dan baris pembalik ditambahkan (jejak tidak dihapus). */
export function voidManualLine(e: EventCapture, at: string, by: string, reason: string): EventCapture[] {
  if (!e.manual || !e.line || e.status !== 'tertagih') return [e];
  return [
    { ...e, status: 'dibalik' },
    {
      id: `${e.id}-batal`,
      at,
      source: 'kasir',
      event: 'charge.manual_voided',
      description: `Pembatalan baris manual: ${reason}`,
      patient: e.patient,
      status: 'dibalik',
      line: reversal(e.line),
      manual: { by, reason },
      reverses: e.id,
    },
  ];
}

export const KOREKSI_REASON_MIN = 15;
