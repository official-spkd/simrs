'use server';

import {
  type StockAdjustmentView,
  stockAdjustmentInputSchema,
  stockAdjustmentViewSchema,
  type StockDrugView,
  stockDrugViewSchema,
  type StockReceiptView,
  stockReceiptInputSchema,
  stockReceiptViewSchema,
  stockTransferCancelInputSchema,
  stockTransferInputSchema,
  type StockTransferView,
  stockTransferViewSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * S05 · Server Action layar Depo mode api (potongan 4.6a): BFF tipis ke `/api/v1/stock/*`. Sesi + izin diperiksa di
 * sini agar pesannya jelas; API menegakkan ulang izin, lingkup unit, FEFO/kedaluwarsa, dan saldo tidak negatif.
 * Jalur presentasi di `actions-demo.ts`.
 */

type Fail = { ok: false; message: string };

async function authorize(action: 'read' | 'receive' | 'transfer' | 'adjust', message: string) {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'stock', action) ? null : ({ ok: false, message } as Fail);
}

function failure(err: unknown): Fail {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const refresh = () => revalidatePath('/penunjang/depo');

/** Idempotency-Key per submit dibuat klien (UUID); klik ganda/kirim ulang dengan kunci sama = satu efek. */
const keySchema = z.uuid();
const BAD_KEY: Fail = { ok: false, message: 'Muat ulang halaman lalu ulangi.' };

/** Cari obat formularium aktif untuk penerimaan barang (maks. 30). */
export async function searchStockDrugsAction(
  q: unknown,
): Promise<{ ok: true; items: StockDrugView[] } | Fail> {
  const denied = await authorize('receive', 'Peran Anda tidak berizin menerima barang.');
  if (denied) return denied;
  const term = z.string().trim().max(80).safeParse(q);
  if (!term.success) return { ok: false, message: 'Kata kunci tidak valid.' };
  try {
    const items = await api(`/api/v1/stock/drugs?q=${encodeURIComponent(term.data)}`, {
      schema: z.array(stockDrugViewSchema),
    });
    return { ok: true, items };
  } catch (err) {
    return failure(err);
  }
}

/** Penerimaan barang tanpa PO (nomor TRM, batch + ED + harga pokok). */
export async function receiveStockAction(
  input: unknown,
  idempotencyKey: unknown,
): Promise<{ ok: true; receipt: StockReceiptView } | Fail> {
  const denied = await authorize('receive', 'Peran Anda tidak berizin menerima barang.');
  if (denied) return denied;
  const p = stockReceiptInputSchema.safeParse(input);
  if (!p.success) {
    return {
      ok: false,
      message: 'Lengkapi pemasok, nomor faktur, dan setiap baris (obat, batch, ED, jumlah, harga).',
    };
  }
  const key = keySchema.safeParse(idempotencyKey);
  if (!key.success) return BAD_KEY;
  try {
    const receipt = await api('/api/v1/stock/receipts', {
      method: 'POST',
      idempotencyKey: key.data,
      body: p.data,
      schema: stockReceiptViewSchema,
    });
    refresh();
    return { ok: true, receipt };
  } catch (err) {
    return failure(err);
  }
}

/** Mutasi langkah kirim (batch dipilih FEFO di layar, diperiksa ulang API). */
export async function sendTransferAction(
  input: unknown,
  idempotencyKey: unknown,
): Promise<{ ok: true; transfer: StockTransferView } | Fail> {
  const denied = await authorize('transfer', 'Peran Anda tidak berizin memutasi stok.');
  if (denied) return denied;
  const p = stockTransferInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Mutasi belum lengkap.' };
  const key = keySchema.safeParse(idempotencyKey);
  if (!key.success) return BAD_KEY;
  try {
    const transfer = await api('/api/v1/stock/transfers', {
      method: 'POST',
      idempotencyKey: key.data,
      body: p.data,
      schema: stockTransferViewSchema,
    });
    refresh();
    return { ok: true, transfer };
  } catch (err) {
    return failure(err);
  }
}

/** Mutasi langkah terima di depo tujuan. */
export async function receiveTransferAction(
  id: unknown,
  idempotencyKey: unknown,
): Promise<{ ok: true; transfer: StockTransferView } | Fail> {
  const denied = await authorize('transfer', 'Peran Anda tidak berizin menerima mutasi.');
  if (denied) return denied;
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, message: 'Mutasi tidak dikenali.' };
  const key = keySchema.safeParse(idempotencyKey);
  if (!key.success) return BAD_KEY;
  try {
    const transfer = await api(`/api/v1/stock/transfers/${p.data}/receive`, {
      method: 'POST',
      idempotencyKey: key.data,
      body: {},
      schema: stockTransferViewSchema,
    });
    refresh();
    return { ok: true, transfer };
  } catch (err) {
    return failure(err);
  }
}

/** Penyesuaian stok beralasan (opname, rusak, hapus buku kedaluwarsa). */
export async function adjustStockAction(
  input: unknown,
  idempotencyKey: unknown,
): Promise<{ ok: true; adjustment: StockAdjustmentView } | Fail> {
  const denied = await authorize('adjust', 'Peran Anda tidak berizin menyesuaikan stok.');
  if (denied) return denied;
  const p = stockAdjustmentInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Isi selisih (bukan nol) dan alasan minimal 10 karakter.' };
  const key = keySchema.safeParse(idempotencyKey);
  if (!key.success) return BAD_KEY;
  try {
    const adjustment = await api('/api/v1/stock/adjustments', {
      method: 'POST',
      idempotencyKey: key.data,
      body: p.data,
      schema: stockAdjustmentViewSchema,
    });
    refresh();
    return { ok: true, adjustment };
  } catch (err) {
    return failure(err);
  }
}

const cancelInput = z.strictObject({
  transferId: z.uuid(),
  reason: stockTransferCancelInputSchema.shape.reason,
});

/** Batalkan mutasi `dikirim` beralasan (petugas depo asal); stok kembali ke depo asal. */
export async function cancelTransferAction(
  input: unknown,
): Promise<{ ok: true; transfer: StockTransferView } | Fail> {
  const denied = await authorize('transfer', 'Peran Anda tidak berizin membatalkan mutasi.');
  if (denied) return denied;
  const p = cancelInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Alasan pembatalan wajib diisi (minimal 10 karakter).' };
  try {
    const transfer = await api(`/api/v1/stock/transfers/${p.data.transferId}/cancel`, {
      method: 'POST',
      body: { reason: p.data.reason },
      schema: stockTransferViewSchema,
    });
    refresh();
    return { ok: true, transfer };
  } catch (err) {
    return failure(err);
  }
}
