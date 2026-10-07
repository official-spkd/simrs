'use server';

import {
  CPOE_ORDER_KINDS,
  type OrderCatalogItem,
  orderCatalogItemSchema,
  orderCancelInputSchema,
  type OrderEvaluation,
  orderEvaluationSchema,
  type OrderGroup,
  orderGroupSchema,
  orderSubmitInputSchema,
} from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * K09 · Server Action layar CPOE mode api (W2): BFF tipis ke `/api/v1/orders/*`. Sesi + izin diperiksa di sini agar
 * pesannya jelas; API menegakkan ulang izin, ABAC pasien, CDS, dan Idempotency-Key. Jalur demo dibekukan di
 * `actions-demo.ts`.
 */

type Fail = { ok: false; message: string };

async function authorize(resource: string, action: string, message: string): Promise<Fail | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, resource, action) ? null : { ok: false, message };
}

function failure(err: unknown): Fail {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const pathOf = (encounterId: string) => `/klinis/order/${encounterId}`;

const searchInput = z.strictObject({
  q: z.string().trim().max(80),
  kind: z.enum(CPOE_ORDER_KINDS).nullable(),
});

/** Cari katalog (nama/kata kunci), maksimal 20 hasil. */
export async function searchCatalogAction(
  input: unknown,
): Promise<{ ok: true; items: OrderCatalogItem[] } | Fail> {
  const denied = await authorize('order', 'read', 'Peran Anda tidak berizin membuka katalog order.');
  if (denied) return denied;
  const p = searchInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Kata kunci tidak valid.' };
  const qs = new URLSearchParams({ q: p.data.q, limit: '20' });
  if (p.data.kind) qs.set('kind', p.data.kind);
  try {
    const items = await api(`/api/v1/orders/catalog?${qs.toString()}`, {
      schema: z.array(orderCatalogItemSchema),
    });
    return { ok: true, items };
  } catch (err) {
    return failure(err);
  }
}

/** Pratinjau CDS server untuk daftar order yang sedang disusun (tidak menyimpan apa pun). */
export async function evaluateOrdersAction(
  input: unknown,
): Promise<{ ok: true; evaluation: OrderEvaluation } | Fail> {
  const denied = await authorize('order', 'write', 'Peran Anda tidak berizin menulis order.');
  if (denied) return denied;
  const p = orderSubmitInputSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Daftar order belum lengkap.' };
  try {
    const evaluation = await api('/api/v1/orders/evaluate', {
      method: 'POST',
      body: p.data,
      schema: orderEvaluationSchema,
    });
    return { ok: true, evaluation };
  } catch (err) {
    return failure(err);
  }
}

export type SubmitOrdersResult =
  { ok: true; group: OrderGroup } | { ok: false; message: string; evaluation?: OrderEvaluation };

/**
 * Kirim order (TTE resep oleh API bila berwenang). `idempotencyKey` dibuat klien sekali per daftar order dan dipakai
 * ulang saat mengirim ulang daftar yang sama, sehingga klik ganda atau jaringan putus tidak menggandakan order.
 * Ditolak CDS → hasil evaluasi server dikembalikan untuk ditampilkan di gerbang keselamatan.
 */
export async function submitOrdersAction(
  input: unknown,
  idempotencyKey: unknown,
): Promise<SubmitOrdersResult> {
  const denied = await authorize('order', 'write', 'Peran Anda tidak berizin menulis order.');
  if (denied) return denied;
  const p = orderSubmitInputSchema.safeParse(input);
  const key = z.uuid().safeParse(idempotencyKey);
  if (!p.success || !key.success) return { ok: false, message: 'Daftar order belum lengkap.' };
  try {
    const group = await api('/api/v1/orders/submit', {
      method: 'POST',
      body: p.data,
      idempotencyKey: key.data,
      schema: orderGroupSchema,
    });
    revalidatePath(pathOf(p.data.encounterId));
    return { ok: true, group };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CDS_BLOCKED') {
      const evaluation = orderEvaluationSchema.safeParse(err.details);
      return {
        ok: false,
        message: err.message,
        evaluation: evaluation.success ? evaluation.data : undefined,
      };
    }
    return failure(err);
  }
}

const cancelInput = z.strictObject({
  encounterId: z.uuid(),
  orderId: z.uuid(),
  reason: orderCancelInputSchema.shape.reason,
});

/** Batalkan satu order aktif dengan alasan (isi order tetap; status `dibatalkan` tercatat). */
export async function cancelOrderAction(input: unknown): Promise<{ ok: true } | Fail> {
  const denied = await authorize('order', 'cancel', 'Peran Anda tidak berizin membatalkan order.');
  if (denied) return denied;
  const p = cancelInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Alasan pembatalan wajib diisi (minimal 10 karakter).' };
  try {
    await api(`/api/v1/orders/${p.data.orderId}/cancel`, {
      method: 'POST',
      body: { reason: p.data.reason },
      schema: orderGroupSchema,
    });
    revalidatePath(pathOf(p.data.encounterId));
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

const reviewInput = z.strictObject({ encounterId: z.uuid(), groupId: z.uuid() });

/**
 * Tinjauan DPJP atas order residen: atestasi `review_order` + resep ber-TTE DPJP peninjau (API memeriksa DPJP utama,
 * rawat bersama, atau DPJP kunjungan). Tugas worklist "Tinjau order residen" ikut tertutup.
 */
export async function reviewOrderAction(input: unknown): Promise<{ ok: true; message: string } | Fail> {
  const denied = await authorize('clinical', 'sign', 'Tinjauan order residen hanya oleh DPJP.');
  if (denied) return denied;
  const p = reviewInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Kiriman order tidak dikenali.' };
  try {
    const group = await api(`/api/v1/orders/${p.data.groupId}/review`, {
      method: 'POST',
      body: {},
      schema: orderGroupSchema,
    });
    revalidatePath(pathOf(p.data.encounterId));
    return {
      ok: true,
      message: group.prescription
        ? 'Order residen ditinjau · resep dikirim untuk TTE atas nama Anda.'
        : 'Order residen ditinjau.',
    };
  } catch (err) {
    return failure(err);
  }
}
