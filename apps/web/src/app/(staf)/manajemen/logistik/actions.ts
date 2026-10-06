'use server';

import { formatRupiah, formatTanggal } from '@simrs/shared';
import { z } from 'zod';
import { jamSchema } from '@/lib/backoffice-toko';
import { buildPoEvent, buildReceipt, EXPIRY_ACTIONS } from '@/lib/logistik-toko';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * Server Action logistik (B01, mode presentasi ADR-0023/0085): gerbang demo, sesi lengkap, posisi pemakai layar
 * `logistik`, input zod. Nomor PO/GRN, harga, total (bigint), dan jatuh tempo dihitung di server dari keadaan toko
 * terkini, lalu `commitEvent` menegakkan ulang semua gerbang domain `logistik` dengan pelaku dari sesi.
 */

export interface LogisticsActionResult {
  ok: boolean;
  message: string;
  stale?: boolean;
}

const rev = z.number().int().min(0);
const poNo = z.string().regex(/^PO-\d{4}-\d{3}$/);

const submitSchema = z.strictObject({
  lines: z
    .array(z.strictObject({ itemId: z.string().min(1).max(40), qty: z.number().int().min(1).max(100_000) }))
    .min(1)
    .max(50),
  jam: jamSchema,
  rev,
});

export async function submitPoAction(input: unknown): Promise<LogisticsActionResult> {
  const s = await manajemenSession('logistik');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  const p = submitSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Draf PO tidak sah. Pilih ulang item.' };
  const { state } = await readDomain('logistik');
  const built = buildPoEvent(state, p.data.lines, p.data.jam);
  if ('error' in built) return { ok: false, message: built.error };
  const r = await commitEvent('logistik', built.event, { rev: p.data.rev, session: s });
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  const e = built.event;
  return {
    ok: true,
    message: `Usulan ${e.number} diajukan ke direktur pukul ${e.jam} · ${e.lines.length} item · total ${formatRupiah(BigInt(e.total))}.`,
  };
}

const stepSchema = z.strictObject({
  type: z.enum(['po.disetujui', 'po.diterbitkan', 'po.dikirim']),
  po: poNo,
  jam: jamSchema,
  rev,
});

const STEP_TEXT = {
  'po.disetujui': 'disetujui direktur; siap terbit PO / e-katalog',
  'po.diterbitkan': 'terbit sebagai PO ke pemasok',
  'po.dikirim': 'dikirim pemasok; siap diterima di gudang',
} as const;

/** Persetujuan direktur (hanya posisi Manajemen, pengusul ≠ penyetuju), terbit PO, konfirmasi dikirim pemasok. */
export async function poStepAction(input: unknown): Promise<LogisticsActionResult> {
  const s = await manajemenSession('logistik');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  const p = stepSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Tahap PO tidak dikenali.' };
  const { type, po, jam } = p.data;
  const r = await commitEvent('logistik', { type, po, jam }, { rev: p.data.rev, session: s });
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, message: `${po} ${STEP_TEXT[type]} · ${jam}.` };
}

const receiveSchema = z.strictObject({
  po: poNo,
  inputs: z.record(
    z.string().min(1).max(40),
    z.strictObject({
      received: z.string().max(12),
      batch: z.string().max(40),
      expiry: z.string().max(10),
    }),
  ),
  coldChainOk: z.boolean(),
  jam: jamSchema,
  rev,
});

/**
 * Catat penerimaan barang: stok bertambah, dan kejadian `logistik/penerimaan.dicatat` diterbitkan untuk Hutang usaha
 * (CX-2). Nilai = Σ harga katalog × diterima (bigint), jatuh tempo 30 hari.
 */
export async function receiveGoodsAction(input: unknown): Promise<LogisticsActionResult> {
  const s = await manajemenSession('logistik');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  const p = receiveSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Isian penerimaan tidak sah.' };
  const { state } = await readDomain('logistik');
  const built = buildReceipt(state, p.data.po, p.data.inputs, p.data.coldChainOk, p.data.jam);
  if ('error' in built) return { ok: false, message: built.error };
  const r = await commitEvent('logistik', built.event, { rev: p.data.rev, session: s });
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  const e = built.event;
  const added = e.items.map((i) => `+${i.received.toLocaleString('id-ID')} ${i.unit}`).join(', ');
  return {
    ok: true,
    message: `${e.grn} dicatat ${e.jam}: stok ${added}; persediaan dan utang penerimaan belum difakturkan ${formatRupiah(BigInt(e.total))} jatuh tempo ${formatTanggal(e.jatuhTempo)} · diteruskan ke Hutang usaha.`,
  };
}

const expirySchema = z.strictObject({
  id: z.string().min(1).max(40),
  action: z.enum(EXPIRY_ACTIONS),
  jam: jamSchema,
  rev,
});

/** Tindak lanjut batch kedaluwarsa ≤ 90 hari: pindah ke depo pemakai terbesar atau retur ke distributor. */
export async function expiryAction(input: unknown): Promise<LogisticsActionResult> {
  const s = await manajemenSession('logistik');
  if (!s) return { ok: false, message: DENIED_MESSAGE };
  const p = expirySchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Tindakan kedaluwarsa tidak dikenali.' };
  const { id, action, jam } = p.data;
  const r = await commitEvent(
    'logistik',
    { type: 'kedaluwarsa.ditindak', id, action, jam },
    { rev: p.data.rev, session: s },
  );
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  return { ok: true, message: 'Tersimpan.' };
}
