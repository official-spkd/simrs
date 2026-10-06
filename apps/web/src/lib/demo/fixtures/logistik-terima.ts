import type { ReceiptLine } from '../../logistik-terima';
import { INVENTORY } from './manajemen';

/**
 * B01 · Baris PO yang sedang dikirim (tahap "kirim") untuk alur penerimaan barang (ADR-0023). Harga dari katalog
 * `INVENTORY`; total PO di `PURCHASE_ORDERS` sama dengan jumlah baris ini (dijaga tes).
 */

function line(itemId: string, ordered: number): ReceiptLine {
  const i = INVENTORY.find((x) => x.id === itemId);
  if (!i) throw new Error(`item fixture tidak ada: ${itemId}`);
  return {
    itemId,
    name: i.name,
    unit: i.unit,
    ordered,
    unitPrice: i.unitPrice,
    cold: i.note.includes('dingin'),
  };
}

export const PO_RECEIPT_LINES: Record<string, readonly ReceiptLine[]> = {
  'PO-2610-024': [
    line('kasa-steril', 7_000),
    line('benang-pga', 200),
    line('sarung-tangan-steril', 1_000),
    line('spuit-3ml', 1_000),
  ],
};

export const PO_SUPPLIER: Record<string, string> = { 'PO-2610-024': 'Distributor alkes B' };
