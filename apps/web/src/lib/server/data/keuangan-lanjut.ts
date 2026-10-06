import 'server-only';
import { COSTING_PERIOD, DRIVER_OVERHEAD, KASUS_COSTING } from '../../demo/fixtures/costing';
import { CAPTURE_EVENT_TOTAL, CAPTURE_EVENTS } from '../../demo/fixtures/charge-capture';
import { FAKTUR_PEMASOK, HUTANG_SUMMARY } from '../../demo/fixtures/hutang';
import { LACI, MUTASI_BANK, REKENING_KORAN } from '../../demo/fixtures/kas-bank';
import { ATURAN_JASPEL, JASPEL_START, REKAP_SEPTEMBER, TINDAKAN_JASPEL } from '../../demo/fixtures/jaspel';
import { AGING } from '../../demo/fixtures/keuangan';
import { AUDIT_KODING, BERKAS_KODING, BUKTI_RME } from '../../demo/fixtures/koding';
import {
  BATCH_TAGIHAN,
  CONTOH_PEMBAGIAN,
  NEXT_BATCH_SEQ,
  PENYESUAIAN,
  PIUTANG_ITEMS,
} from '../../demo/fixtures/piutang';
import {
  ATURAN_NAIK_KELAS,
  TARIF_ITEM_TOTAL,
  TARIF_ITEMS,
  TARIF_PAKET,
  TARIF_PENJAMIN,
  TARIF_USULAN,
} from '../../demo/fixtures/tarif';
import { applyCaptures } from '../../keuangan-tagihan-toko';
import { readDomain } from '../demo/state';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * U01–U10 dan I10 lanjutan (tarif, charge capture, piutang, koding, jasa pelayanan, kas & bank, hutang, costing):
 * satu-satunya pintu data layar ini. Mode presentasi: data dummy fiktif (ADR-0023); mode api menunggu backend
 * fase 5 (rencana `docs/rencana/fase-5-keuangan.md`).
 */

const demoOnly = (domain: string): void => {
  if (webEnv().dataSource !== 'demo') notImplemented(domain);
  assertDemo();
};

export function getTariffBoard() {
  demoOnly('tarif (U01)');
  return {
    items: TARIF_ITEMS,
    itemTotal: TARIF_ITEM_TOTAL,
    payers: TARIF_PENJAMIN,
    proposals: TARIF_USULAN,
    packages: TARIF_PAKET,
    upgradeRules: ATURAN_NAIK_KELAS,
  };
}
export type TariffBoard = ReturnType<typeof getTariffBoard>;

export function getChargeCaptureBoard() {
  demoOnly('charge capture (U02)');
  return { events: CAPTURE_EVENTS, eventTotal: CAPTURE_EVENT_TOTAL };
}

/**
 * Monitor charge capture di atas toko demo (domain `tagihan`): event fixture + event baru (pendaftaran, item manual
 * kasir) dengan tindak lanjut tersimpan. Satu jalur untuk halaman dan Server Action.
 */
export async function getChargeCaptureStore() {
  demoOnly('charge capture (U02)');
  const tg = await readDomain('tagihan');
  const events = applyCaptures(CAPTURE_EVENTS, tg.state);
  return {
    events,
    eventTotal: CAPTURE_EVENT_TOTAL + tg.state.newCaptures.length,
    rev: tg.rev,
    /** Event baru → tagihan Kasir (untuk tautan dan gerbang pembatalan). */
    invoiceOf: Object.fromEntries(tg.state.newCaptures.map((c) => [c.id, c.invoiceId])),
    /** Tagihan yang sudah final/lunas di toko (baris manualnya tidak bisa dibatalkan lagi). */
    lockedInvoices: Object.entries(tg.state.invoices)
      .filter(([, o]) => o.finalizedAt || o.closedAt)
      .map(([id]) => id),
  };
}
export type ChargeCaptureStore = Awaited<ReturnType<typeof getChargeCaptureStore>>;

export function getReceivablesBoard() {
  demoOnly('piutang (U04)');
  return {
    aging: AGING,
    examples: CONTOH_PEMBAGIAN,
    items: PIUTANG_ITEMS,
    batches: BATCH_TAGIHAN,
    nextBatchSeq: NEXT_BATCH_SEQ,
    adjustments: PENYESUAIAN,
  };
}
export type ReceivablesBoard = ReturnType<typeof getReceivablesBoard>;

export function getCodingBoard() {
  demoOnly('workbench koder (U06)');
  return { berkas: BERKAS_KODING, evidence: BUKTI_RME, audit: AUDIT_KODING };
}
export type CodingBoard = ReturnType<typeof getCodingBoard>;

export function getFeeSharingBoard() {
  demoOnly('jasa pelayanan (U08)');
  return { rule: ATURAN_JASPEL, items: TINDAKAN_JASPEL, september: REKAP_SEPTEMBER, start: JASPEL_START };
}
export type FeeSharingBoard = ReturnType<typeof getFeeSharingBoard>;

export function getCashBankBoard() {
  demoOnly('kas dan bank (U09)');
  return { drawers: LACI, mutations: MUTASI_BANK, statement: REKENING_KORAN };
}
export type CashBankBoard = ReturnType<typeof getCashBankBoard>;

export function getPayablesBoard() {
  demoOnly('hutang usaha (U10)');
  return { invoices: FAKTUR_PEMASOK, summary: HUTANG_SUMMARY };
}
export type PayablesBoard = ReturnType<typeof getPayablesBoard>;

export function getCostingBoard() {
  demoOnly('costing dan case-mix (I10)');
  return { cases: KASUS_COSTING, drivers: DRIVER_OVERHEAD, period: COSTING_PERIOD };
}
export type CostingBoard = ReturnType<typeof getCostingBoard>;
