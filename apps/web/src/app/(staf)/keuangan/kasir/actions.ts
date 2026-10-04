'use server';

import { CHARGE_CATEGORIES, formatJam, formatRupiah, PAYMENT_METHODS } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { MANUAL_REASON_MIN, manualLineProblems, PAYMENT_METHOD_LABEL } from '@/lib/keuangan';
import { screenById, screenOpen } from '@/lib/screens';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action Kasir mode presentasi (ADR-0023). Endpoint POST publik: gerbang demo, sesi lengkap, posisi kasir,
 * dan input divalidasi di sini. Tidak menyimpan apa pun; umpan balik ditandai "(simulasi, tidak disimpan)".
 * Pasien skenario dimajukan lewat `demoCommandAction` (mesin skenario), bukan lewat action ini.
 */

export interface KasirActionResult {
  ok: boolean;
  message: string;
  /** Jam aksi (WIB), mis. "10.42". */
  at?: string;
}

const invoiceId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('manual'),
    invoiceId,
    name: z.string().trim().min(3).max(80),
    category: z.enum(CHARGE_CATEGORIES),
    qty: z.number().int().min(1).max(99),
    unitPrice: z.string().regex(/^\d{1,9}$/),
    reason: z.string().trim().min(MANUAL_REASON_MIN).max(300),
  }),
  z.strictObject({ type: z.literal('final'), invoiceId }),
  z.strictObject({
    type: z.literal('bayar'),
    invoiceId,
    method: z.enum(PAYMENT_METHODS),
    amount: z.string().regex(/^\d{1,12}$/),
    receiptNo: z.string().regex(/^KW-\d{4}-\d{5}$/),
  }),
  z.strictObject({ type: z.literal('tutup'), invoiceId }),
  z.strictObject({ type: z.literal('tutup-shift') }),
]);
export type KasirActionInput = z.infer<typeof inputSchema>;

async function kasirSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById('kasir');
  return screen && screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null }) ? s : null;
}

const SIM = '(simulasi, tidak disimpan)';

export async function kasirAction(input: KasirActionInput): Promise<KasirActionResult> {
  const s = await kasirSession();
  if (!s) return { ok: false, message: 'Posisi aktif bukan kasir. Ganti posisi untuk memakai layar ini.' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Isian tidak lengkap atau tidak sah.' };
  const c = parsed.data;
  const at = formatJam(new Date());
  switch (c.type) {
    case 'manual': {
      const problems = manualLineProblems({
        name: c.name,
        qty: c.qty,
        unitPrice: BigInt(c.unitPrice),
        reason: c.reason,
      });
      if (problems.length) return { ok: false, message: `Belum bisa diajukan: ${problems.join(', ')}.` };
      return {
        ok: true,
        at,
        message: `Item manual ditambahkan dan alasan tercatat di jejak audit · ${at} ${SIM}`,
      };
    }
    case 'final':
      return { ok: true, at, message: `Tagihan difinalkan dan dikunci · ${at} ${SIM}` };
    case 'bayar':
      return {
        ok: true,
        at,
        message: `${PAYMENT_METHOD_LABEL[c.method].name} ${formatRupiah(BigInt(c.amount))} diterima · kuitansi ${c.receiptNo} · jurnal bank terbentuk otomatis · ${at} ${SIM}`,
      };
    case 'tutup':
      return { ok: true, at, message: `Kunjungan ditutup, pasien bayar Rp 0 · ${at} ${SIM}` };
    case 'tutup-shift':
      return { ok: true, at, message: `Shift ditutup, rekap kas dikirim ke akuntansi · ${at} ${SIM}` };
  }
}
