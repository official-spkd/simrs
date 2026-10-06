import 'server-only';
import { CAPTURE_EVENT_TOTAL, CAPTURE_EVENTS } from '../../demo/fixtures/charge-capture';
import { AGING } from '../../demo/fixtures/keuangan';
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
