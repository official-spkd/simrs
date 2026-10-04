'use server';

import { CHARGE_CATEGORIES, formatJam, formatRupiah, PAYMENT_METHODS, sumRupiah } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  invoiceSettlement,
  localActionProblem,
  MANUAL_REASON_MIN,
  manualLineProblems,
  PAYMENT_METHOD_LABEL,
} from '@/lib/keuangan';
import { screenById, screenOpen } from '@/lib/screens';
import { getKasirBoard } from '@/lib/server/data/keuangan';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * Server Action Kasir mode presentasi (ADR-0023). Endpoint POST publik: gerbang demo, sesi lengkap, posisi kasir,
 * dan input divalidasi di sini. Tagihan dibaca ulang dari jalur data yang sama dengan halaman: tagihan tak dikenal,
 * pasien skenario, atau yang sudah lunas ditolak, dan nominal dihitung ulang server dari baris tagihan + item
 * manual yang diajukan (bukan dipercaya dari klien). Tidak menyimpan apa pun; umpan balik ditandai "(simulasi,
 * tidak disimpan)". Pasien skenario dimajukan lewat `demoCommandAction` (mesin skenario), bukan lewat action ini.
 */

export interface KasirActionResult {
  ok: boolean;
  message: string;
  /** Jam aksi (WIB), mis. "10.42". */
  at?: string;
}

const invoiceId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const manualLine = z.strictObject({
  name: z.string().trim().min(3).max(80),
  category: z.enum(CHARGE_CATEGORIES),
  qty: z.number().int().min(1).max(99),
  unitPrice: z.string().regex(/^\d{1,9}$/),
  reason: z.string().trim().min(MANUAL_REASON_MIN).max(300),
});
/** Item manual yang sudah ditambahkan di layar (ikut dihitung ulang server saat bayar/tutup). */
const manualLines = z.array(manualLine).max(20);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('manual'), invoiceId, ...manualLine.shape }),
  z.strictObject({ type: z.literal('final'), invoiceId }),
  z.strictObject({
    type: z.literal('bayar'),
    invoiceId,
    method: z.enum(PAYMENT_METHODS),
    amount: z.string().regex(/^\d{1,12}$/),
    manual: manualLines,
  }),
  z.strictObject({ type: z.literal('tutup'), invoiceId, manual: manualLines }),
  z.strictObject({ type: z.literal('tutup-shift') }),
]);
export type KasirActionInput = z.infer<typeof inputSchema>;
export type ManualLineInput = z.infer<typeof manualLine>;

async function kasirSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById('kasir');
  return screen && screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null }) ? s : null;
}

const SIM = '(simulasi, tidak disimpan)';

/** Gerbang item manual (sama dengan tombol layar) untuk satu baris; daftar masalah. */
function lineProblems(l: ManualLineInput): string[] {
  return manualLineProblems({ name: l.name, qty: l.qty, unitPrice: BigInt(l.unitPrice), reason: l.reason });
}

export async function kasirAction(input: KasirActionInput): Promise<KasirActionResult> {
  const s = await kasirSession();
  if (!s) return { ok: false, message: 'Posisi aktif bukan kasir. Ganti posisi untuk memakai layar ini.' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Isian tidak lengkap atau tidak sah.' };
  const c = parsed.data;
  const at = formatJam(new Date());
  if (c.type === 'tutup-shift') {
    return { ok: true, at, message: `Shift ditutup, rekap kas dikirim ke akuntansi · ${at} ${SIM}` };
  }
  const board = await getKasirBoard(s);
  const inv = board.invoices.find((i) => i.id === c.invoiceId);
  const refused = localActionProblem(inv, c.type);
  if (refused || !inv) return { ok: false, message: refused ?? 'Tagihan tidak ditemukan.' };
  if (c.type === 'manual') {
    const problems = lineProblems(c);
    if (problems.length) return { ok: false, message: `Belum bisa diajukan: ${problems.join(', ')}.` };
    return {
      ok: true,
      at,
      message: `Item manual ditambahkan dan alasan tercatat di jejak audit · ${at} ${SIM}`,
    };
  }
  if (c.type === 'final') {
    return { ok: true, at, message: `Tagihan ${inv.number} difinalkan dan dikunci · ${at} ${SIM}` };
  }
  if (c.manual.some((l) => lineProblems(l).length > 0)) {
    return { ok: false, message: 'Item manual tidak sah; tambahkan ulang dengan alasan tertulis.' };
  }
  const { split, due } = invoiceSettlement(
    inv,
    c.manual.map((l) => ({ amount: (BigInt(l.unitPrice) * BigInt(l.qty)).toString() })),
  );
  if (c.type === 'bayar') {
    if (due <= 0n) return { ok: false, message: 'Tidak ada sisa tagihan pasien; tutup kunjungan saja.' };
    if (BigInt(c.amount) !== due) {
      return {
        ok: false,
        message: `Nominal tidak sesuai sisa tagihan (${formatRupiah(due)}). Muat ulang tagihan.`,
      };
    }
    const receipt = inv.receiptNo ?? inv.number.replace('INV', 'KW');
    return {
      ok: true,
      at,
      message: `${PAYMENT_METHOD_LABEL[c.method].name} ${formatRupiah(due)} diterima · kuitansi ${receipt} · jurnal bank terbentuk otomatis · ${at} ${SIM}`,
    };
  }
  if (due > 0n) {
    return { ok: false, message: `Belum bisa ditutup: pasien masih harus membayar ${formatRupiah(due)}.` };
  }
  const share = BigInt(split.patientShare);
  const paid = sumRupiah(inv.payments.map((p) => BigInt(p.amount)));
  return {
    ok: true,
    at,
    message:
      share === 0n
        ? `Kunjungan ditutup, ditanggung penjamin · pasien bayar Rp 0 · ${at} ${SIM}`
        : `Kunjungan ditutup, tanggungan pasien ${formatRupiah(share)} lunas dari pembayaran ${formatRupiah(paid)} · ${at} ${SIM}`,
  };
}
