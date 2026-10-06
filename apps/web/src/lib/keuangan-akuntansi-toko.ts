import {
  type AccountingBoard,
  formatDocumentNumber,
  isoDateJakarta,
  type JournalEntry,
  type JournalSource,
  sumRupiah,
} from '@simrs/shared';
import { z } from 'zod';
import { type DemoActor, type DomainEvent, type DomainSource, defineDomain, on } from './demo/store/define';
import {
  BANK_RECON,
  BPJS_TRANSFER_JOURNAL_ID,
  JOURNAL_COUNT,
  MAPPING_OPTIONS,
  PERIODS,
  STATIC_JOURNALS,
} from './demo/fixtures/keuangan';
import { closeReadiness, needsMapping, reconLabel } from './keuangan-akuntansi';
import { type AutoJurnal, labelPeriode, periodeOf } from './keuangan-jurnal';
import { pembayaranDomain } from './btn-pembayaran-toko';
import { pembiayaanDomain } from './btn-pembiayaan-toko';
import { kasbankDomain } from './keuangan-kasbank-toko';
import { piutangDomain } from './keuangan-piutang-toko';
import { tagihanDomain } from './keuangan-tagihan-toko';

/**
 * U04/U07/U09 · Domain toko demo `akuntansi` (ADR-0085): buku jurnal otomatis dari kejadian mutasi uang domain
 * keuangan (langganan), pemetaan akun + persetujuan penyetuju kedua (pembuat ≠ penyetuju dari pengguna sesi),
 * pemadanan mutasi bank, ekspor, dan tutup periode (mengunci periode).
 *
 * Tutup periode diblokir selama ada jurnal yang menunggu penyetuju kedua (usulan K-2 `docs/13` §8, **menunggu
 * konfirmasi pemilik produk**), selain jurnal belum dipetakan dan mutasi bank belum dipadankan.
 */

export const AKUNTANSI_DOMAIN = 'akuntansi';

const stamp = z.iso.datetime({ offset: true });
const journalId = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const akuntansiEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('jurnal.petakan'),
    journalId,
    accountCode: z.string().regex(/^\d-\d{4}$/),
    at: stamp,
  }),
  z.strictObject({ type: z.literal('jurnal.setujui'), journalId, at: stamp }),
  z.strictObject({ type: z.literal('rekening.padankan'), accountId: journalId, at: stamp }),
  z.strictObject({
    type: z.literal('periode.tutup'),
    periodId: z.string().regex(/^\d{4}-\d{2}$/),
    at: stamp,
  }),
  z.strictObject({ type: z.literal('laporan.ekspor'), at: stamp }),
]);
export type AkuntansiEvent = z.infer<typeof akuntansiEventSchema>;

/** Jurnal otomatis dari kejadian domain keuangan lain. */
export interface StoredJournal {
  /** Id stabil: `ju-toko-<seq kejadian>-<urutan>`. */
  id: string;
  /** Nomor urut jurnal toko (1, 2, …) → nomor JU periode berjalan setelah `JOURNAL_COUNT`. */
  n: number;
  date: string;
  source: JournalSource;
  reference: string;
  description: string;
  status: 'terposting' | 'menunggu-rekonsiliasi';
  reconKey: string | null;
  lines: JournalEntry['lines'];
  /** Domain asal + pelaku (jejak). */
  origin: { domain: string; by: string };
}

export interface Signed {
  by: string;
  byId: string;
  at: string;
}

export interface AkuntansiState {
  journals: readonly StoredJournal[];
  mapped: Readonly<Record<string, Signed & { code: string; name: string }>>;
  approved: Readonly<Record<string, Signed>>;
  matched: Readonly<Record<string, Signed>>;
  /** Kunci rekonsiliasi 3 arah yang sudah cocok (dari Pembayaran digital). */
  reconciled: Readonly<Record<string, Signed>>;
  closed: (Signed & { periodId: string }) | null;
  lastExport: Signed | null;
}

const signed = (a: DemoActor, at: string): Signed => ({ by: a.name, byId: a.userId, at });

/** Periode berjalan papan (Oktober 2026) dan periode yang sudah tertutup sebelum demo. */
export const CURRENT_PERIOD = PERIODS.period;
const CLOSED_BEFORE = new Set([PERIODS.previousPeriod.id]);

/** Periode `YYYY-MM` tertutup (fixture atau ditutup di toko)? */
export function periodClosed(s: Pick<AkuntansiState, 'closed'>, periodId: string): boolean {
  return CLOSED_BEFORE.has(periodId) || s.closed?.periodId === periodId;
}

/** Pesan penolakan mutasi uang bertanggal `at` bila periodenya tertutup; null bila boleh. */
export function periodLockMessage(s: Pick<AkuntansiState, 'closed'>, at: string): string | null {
  const p = periodeOf(at);
  return periodClosed(s, p)
    ? `Periode ${labelPeriode(p)} sudah ditutup dan dikunci; transaksi bertanggal periode itu ditolak (buka ulang butuh direktur keuangan).`
    : null;
}

/** Jurnal fixture yang perlu pemetaan akun (dasar gerbang). */
const MAPPABLE = STATIC_JOURNALS.filter(needsMapping);

/** Syarat tutup periode dari keadaan toko: pemetaan, persetujuan kedua (K-2), dan pemadanan bank. */
export function closeCheck(s: AkuntansiState): { ready: boolean; reason: string; pendingApproval: string[] } {
  const unmapped = MAPPABLE.filter((j) => !s.mapped[j.id]).map((j) => j.number);
  const pendingApproval = MAPPABLE.filter((j) => s.mapped[j.id] && !s.approved[j.id]).map((j) => j.number);
  const unmatchedAccounts = BANK_RECON.filter((b) => b.unmatched.length > 0 && !s.matched[b.id]).map(
    reconLabel,
  );
  const base = closeReadiness({ unmapped, unmatchedAccounts });
  if (pendingApproval.length === 0) return { ...base, pendingApproval };
  const k2 = `jurnal ${pendingApproval.join(', ')} masih menunggu penyetuju kedua`;
  return {
    ready: false,
    pendingApproval,
    reason: base.ready ? `Belum bisa ditutup: ${k2}.` : `${base.reason.replace(/\.$/, '')}; ${k2}.`,
  };
}

function gate(s: AkuntansiState, ev: AkuntansiEvent, actor: DemoActor): string | null {
  const lock = ev.type === 'laporan.ekspor' ? null : periodLockMessage(s, ev.at);
  if (lock) return lock;
  switch (ev.type) {
    case 'jurnal.petakan': {
      const j = MAPPABLE.find((x) => x.id === ev.journalId);
      if (!j) return 'Jurnal tidak ditemukan atau tidak perlu pemetaan akun.';
      if (s.mapped[j.id]) return 'Jurnal ini sudah dipetakan; menunggu penyetuju kedua.';
      return MAPPING_OPTIONS.some((o) => o.code === ev.accountCode)
        ? null
        : 'Akun lawan tidak ada di bagan akun.';
    }
    case 'jurnal.setujui': {
      const m = s.mapped[ev.journalId];
      if (!m) return 'Jurnal belum dipetakan; tidak ada yang perlu disetujui.';
      if (s.approved[ev.journalId]) return 'Jurnal sudah disetujui dan terposting.';
      if (m.byId === actor.userId) {
        return `Pemisahan tugas: pemetaan dibuat oleh ${m.by}; penyetuju kedua harus pengguna lain.`;
      }
      return null;
    }
    case 'rekening.padankan': {
      const acc = BANK_RECON.find((b) => b.id === ev.accountId);
      if (!acc || acc.unmatched.length === 0)
        return 'Tidak ada mutasi yang perlu dipadankan di rekening ini.';
      return s.matched[acc.id] ? 'Mutasi rekening ini sudah dipadankan.' : null;
    }
    case 'periode.tutup': {
      if (ev.periodId !== CURRENT_PERIOD.id || s.closed) return 'Periode tidak sesuai atau sudah ditutup.';
      const c = closeCheck(s);
      return c.ready ? null : c.reason;
    }
    case 'laporan.ekspor':
      return null;
  }
}

/** Tambah jurnal otomatis yang dibawa kejadian domain sumber (urutan = urutan log). */
function addJournals(
  s: AkuntansiState,
  ev: DomainEvent<unknown>,
  jurnal: readonly AutoJurnal[],
  at: string,
): AkuntansiState {
  if (jurnal.length === 0) return s;
  let n = s.journals.length;
  const added: StoredJournal[] = jurnal.map((j, i) => ({
    id: `ju-toko-${ev.seq}-${i + 1}`,
    n: ++n,
    date: at,
    source: j.source,
    reference: j.reference,
    description: j.memo,
    status: j.status,
    reconKey: j.reconKey,
    lines: j.lines.map((l) => ({
      account: { code: l.code, name: l.name },
      debit: l.debit,
      credit: l.credit,
    })),
    origin: { domain: ev.domain, by: ev.actor.name },
  }));
  return { ...s, journals: [...s.journals, ...added] };
}

/**
 * Langganan generik: kejadian domain sumber yang membawa `jurnal` (array jurnal otomatis seimbang) dan `at` (jam demo).
 * Dipakai untuk setiap domain keuangan yang memutasi uang.
 */
export function journalSubscription<E>(source: DomainSource<E>) {
  return on<AkuntansiState, E>(source, (s, ev) => {
    const d = ev.data as { jurnal?: readonly AutoJurnal[]; at?: string };
    return d.jurnal && d.at ? addJournals(s, ev, d.jurnal, d.at) : s;
  });
}

export const akuntansiDomain = defineDomain<AkuntansiState, AkuntansiEvent>(AKUNTANSI_DOMAIN, {
  initial: () => ({
    journals: [],
    mapped: {},
    approved: {},
    matched: {},
    reconciled: {},
    closed: null,
    lastExport: null,
  }),
  eventSchema: akuntansiEventSchema,
  screens: ['akuntansi'],
  validate: gate,
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d, ev.actor);
    if (err) throw new Error(err);
    const sig = signed(ev.actor, d.at);
    switch (d.type) {
      case 'jurnal.petakan': {
        const acc = MAPPING_OPTIONS.find((o) => o.code === d.accountCode);
        if (!acc) return s;
        return { ...s, mapped: { ...s.mapped, [d.journalId]: { ...sig, code: acc.code, name: acc.name } } };
      }
      case 'jurnal.setujui':
        return { ...s, approved: { ...s.approved, [d.journalId]: sig } };
      case 'rekening.padankan':
        return { ...s, matched: { ...s.matched, [d.accountId]: sig } };
      case 'periode.tutup':
        return { ...s, closed: { ...sig, periodId: d.periodId } };
      case 'laporan.ekspor':
        return { ...s, lastExport: sig };
    }
  },
  subscriptions: [
    journalSubscription(tagihanDomain),
    journalSubscription(piutangDomain),
    journalSubscription(kasbankDomain),
    journalSubscription(pembayaranDomain),
    journalSubscription(pembiayaanDomain),
    // Rekonsiliasi 3 arah TPDI × BTN cocok → jurnal QRIS/VA yang menunggu rekonsiliasi terposting.
    on(pembayaranDomain, (s, ev) =>
      ev.data.type === 'rekonsiliasi'
        ? {
            ...s,
            reconciled: {
              ...s.reconciled,
              ...Object.fromEntries(ev.data.reconKeys.map((k) => [k, signed(ev.actor, ev.data.at)])),
            },
          }
        : s,
    ),
  ],
});

// ---------------------------------------------------------------------------------------------------------------
// Penerapan ke papan Akuntansi.
// ---------------------------------------------------------------------------------------------------------------

/** Jurnal toko sebagai entri papan (nomor JU melanjutkan hitungan periode berjalan). */
export function storedToEntry(j: StoredJournal, s: Pick<AkuntansiState, 'reconciled'>): JournalEntry {
  const posted = j.reconKey ? !!s.reconciled[j.reconKey] : true;
  return {
    id: j.id,
    number: formatDocumentNumber(
      'journal',
      BigInt(JOURNAL_COUNT + j.n),
      periodeOf(j.date).replace('-', '').slice(2),
    ),
    date: j.date,
    source: j.source,
    reference: j.reference,
    description: `${j.description} · oleh ${j.origin.by}`,
    status: j.status === 'menunggu-rekonsiliasi' && !posted ? 'menunggu-rekonsiliasi' : 'terposting',
    scenario: null,
    lines: j.lines,
  };
}

const ACC = {
  cash: /^1-11/,
  bpjs: /^1-13[12]0$/,
  revenue: /^4-1[123]00$/,
  revenueContra: /^4-19[05]0$/,
};

/** Saldo bersih (debit − kredit) akun yang cocok pola, dari jurnal toko. */
export function netOf(journals: readonly Pick<StoredJournal, 'lines'>[], re: RegExp): bigint {
  return sumRupiah(
    journals.flatMap((j) =>
      j.lines
        .filter((l) => l.account && re.test(l.account.code))
        .map((l) => BigInt(l.debit) - BigInt(l.credit)),
    ),
  );
}

/** Saldo bersih piutang per kelompok penjamin (masuk kelompok umur 0–30 hari). */
export function receivableDelta(journals: readonly Pick<StoredJournal, 'lines'>[]) {
  return {
    bpjs: netOf(journals, ACC.bpjs),
    asuransi: netOf(journals, /^1-1340$/),
    'kerja-sama': netOf(journals, /^1-1350$/),
    umum: netOf(journals, /^1-1330$/),
  } as const;
}

const add = (a: string, b: bigint) => {
  const v = BigInt(a) + b;
  return (v < 0n ? 0n : v).toString();
};

/**
 * Umur piutang + piutang baru dari jurnal toko periode berjalan (kelompok 0–30 hari). Dipakai layar Akuntansi dan
 * Penjaminan & piutang agar angkanya sama.
 */
export function applyAgingDelta(
  aging: AccountingBoard['aging'],
  s: Pick<AkuntansiState, 'journals'>,
): AccountingBoard['aging'] {
  const delta = receivableDelta(s.journals.filter((j) => periodeOf(j.date) === CURRENT_PERIOD.id));
  return aging.map((row) => {
    const d = delta[row.payer];
    return d === 0n
      ? row
      : { ...row, buckets: [add(row.buckets[0], d), row.buckets[1], row.buckets[2], row.buckets[3]] };
  });
}

/** Papan Akuntansi (fixture + skenario) setelah keadaan toko diterapkan. */
export function applyAkuntansi(board: AccountingBoard, s: AkuntansiState): AccountingBoard {
  const inPeriod = s.journals.filter((j) => periodeOf(j.date) === board.period.id);
  const journals: JournalEntry[] = board.journals.map((j) => {
    const m = s.mapped[j.id];
    if (m && needsMapping(j)) {
      return {
        ...j,
        status: s.approved[j.id] ? 'terposting' : 'menunggu-persetujuan',
        lines: j.lines.map((l) => (l.account ? l : { ...l, account: { code: m.code, name: m.name } })),
      };
    }
    if (j.id === BPJS_TRANSFER_JOURNAL_ID && s.matched['btn-klaim']) return { ...j, status: 'terposting' };
    return j;
  });
  const own = inPeriod.map((j) => storedToEntry(j, s));
  const delta = receivableDelta(inPeriod);
  const revenue = -netOf(inPeriod, ACC.revenue) - netOf(inPeriod, ACC.revenueContra);
  const k = board.kpis;
  return {
    ...board,
    period: s.closed ? { ...board.period, status: 'tertutup', closedAt: s.closed.at } : board.period,
    kpis: {
      ...k,
      revenueMtd: add(k.revenueMtd, revenue),
      bpjsReceivable: add(k.bpjsReceivable, delta.bpjs),
      cashAndBank: add(k.cashAndBank, netOf(inPeriod, ACC.cash)),
    },
    journalCount: board.journalCount + own.length,
    journals: [...journals, ...own].sort(
      (a, b) => Date.parse(a.date) - Date.parse(b.date) || a.number.localeCompare(b.number),
    ),
    aging: applyAgingDelta(board.aging, s),
  };
}

/** Tanggal WIB jurnal toko (untuk filter periode di layar lain). */
export const journalDay = (j: Pick<StoredJournal, 'date'>) => isoDateJakarta(j.date);
