'use server';

import {
  CHARGE_CATEGORIES,
  formatJam,
  formatRupiah,
  type Invoice,
  isoDateJakarta,
  PAYMENT_METHODS,
  sumRupiah,
} from '@simrs/shared';
import { z } from 'zod';
import {
  invoiceSettlement,
  localActionProblem,
  MANUAL_REASON_MIN,
  manualLineProblems,
  PAYMENT_METHOD_LABEL,
  settledCount,
} from '@/lib/keuangan';
import { patientPaymentJournal, recognitionAutoJournal } from '@/lib/keuangan-jurnal';
import { paymentReference, type Settlement } from '@/lib/keuangan-tagihan-toko';
import { getKasirStore } from '@/lib/server/data/keuangan';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
  periodLock,
} from '@/lib/server/data/keuangan-toko';
import type { EventOf } from '@/lib/demo/store/registry';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * Server Action Kasir mode presentasi (ADR-0023/0085). Endpoint POST publik: gerbang demo, sesi lengkap, posisi
 * kasir, input zod. Tagihan dibaca ulang dari jalur data yang sama dengan halaman (fixture + skenario + toko):
 * tagihan tak dikenal, pasien skenario, atau yang sudah lunas ditolak; nominal, pembagian penjamin, dan jurnal dihitung
 * ulang server (tidak dipercaya dari klien). Aksi tersimpan di domain toko `tagihan` atas nama pengguna sesi, lalu
 * mengalir ke Akuntansi (jurnal), Klaim, Piutang, Pembayaran digital, Pembiayaan, dan Kas & bank.
 */

export type KasirActionResult = KeuanganActionResult;

const invoiceId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rev = z.number().int().min(0);
const manualLine = z.strictObject({
  name: z.string().trim().min(3).max(80),
  category: z.enum(CHARGE_CATEGORIES),
  qty: z.number().int().min(1).max(99),
  unitPrice: z.string().regex(/^\d{1,9}$/),
  reason: z.string().trim().min(MANUAL_REASON_MIN).max(300),
});
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('manual'), invoiceId, rev, ...manualLine.shape }),
  z.strictObject({ type: z.literal('final'), invoiceId, rev }),
  z.strictObject({
    type: z.literal('bayar'),
    invoiceId,
    rev,
    method: z.enum(PAYMENT_METHODS),
    amount: z.string().regex(/^\d{1,12}$/),
    /** Tenor cicilan BTN (bulan), wajib untuk metode cicilan. */
    tenor: z.number().int().min(1).max(60).nullable(),
    /** Nomor referensi transfer yang dicocokkan dengan mutasi BTN. */
    transferRef: z.string().trim().max(40).nullable(),
  }),
  z.strictObject({ type: z.literal('tutup'), invoiceId, rev }),
  z.strictObject({ type: z.literal('tutup-shift'), rev }),
  z.strictObject({ type: z.literal('buka-shift'), rev }),
]);
export type KasirActionInput = z.infer<typeof inputSchema>;
export type ManualLineInput = z.infer<typeof manualLine>;

/** Pembagian penjamin saat lunas (dasar jurnal pengakuan, klaim, dan piutang). */
function settlementOf(inv: Invoice, diagnosis: string | null): Settlement {
  const s = inv.split;
  const prepaid = sumRupiah(inv.payments.map((p) => BigInt(p.amount)));
  return {
    scheme: s.scheme,
    payerLabel: s.payerLabel,
    setting: inv.encounter.kind,
    hospitalTotal: s.hospitalTotal,
    payerPays: s.payerPays,
    patientShare: s.patientShare,
    hospitalAbsorbs: s.hospitalAbsorbs,
    prepaid: prepaid.toString(),
    cbg: s.inacbg?.code ?? null,
    sep: inv.encounter.sep,
    dpjp: inv.encounter.dpjp,
    label: inv.encounter.label,
    diagnosis,
  };
}

const recognition = (inv: Invoice, st: Settlement) =>
  recognitionAutoJournal(
    {
      scheme: st.scheme,
      setting: st.setting,
      hospitalTotal: BigInt(st.hospitalTotal),
      payerPays: BigInt(st.payerPays),
      patientShare: BigInt(st.patientShare),
      hospitalAbsorbs: BigInt(st.hospitalAbsorbs),
      prepaid: BigInt(st.prepaid),
    },
    inv.number,
  );

export async function kasirAction(input: KasirActionInput): Promise<KasirActionResult> {
  const s = await keuanganSession('kasir');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const store = await getKasirStore(s);
  const commit = async (event: EventOf<'tagihan'>, message: string): Promise<KasirActionResult> => {
    const r = await commitEvent('tagihan', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message, rev: r.rev } : { ok: false, message: r.error, stale: r.stale };
  };

  if (c.type === 'tutup-shift') {
    const day = isoDateJakarta(at);
    const cash = sumRupiah(
      Object.values(store.state.invoices).flatMap((o) =>
        o.payments.filter((p) => p.method === 'tunai').map((p) => BigInt(p.amount)),
      ),
    );
    const settled = settledCount(store.board.invoices, day);
    return commit(
      { type: 'shift.tutup', at, settled, cash: cash.toString() },
      `Shift ditutup ${jam} · ${settled} tagihan lunas · rekap kas dikirim ke akuntansi`,
    );
  }
  if (c.type === 'buka-shift') {
    return commit({ type: 'shift.buka', at }, `Shift baru dibuka ${jam}`);
  }

  const inv = store.board.invoices.find((i) => i.id === c.invoiceId);
  const refused = localActionProblem(inv, c.type);
  if (refused || !inv) return { ok: false, message: refused ?? 'Tagihan tidak ditemukan.' };

  if (c.type === 'manual') {
    const problems = manualLineProblems({
      name: c.name,
      qty: c.qty,
      unitPrice: BigInt(c.unitPrice),
      reason: c.reason,
    });
    if (problems.length) return { ok: false, message: `Belum bisa diajukan: ${problems.join(', ')}.` };
    return commit(
      {
        type: 'item.manual',
        invoiceId: inv.id,
        patient: {
          name: inv.patient.name,
          rm: inv.patient.rm,
          place: inv.encounter.location,
          payer: inv.split.payerLabel,
        },
        name: c.name,
        category: c.category,
        qty: c.qty,
        unitPrice: c.unitPrice,
        reason: c.reason,
        at,
      },
      `Item manual ${c.name} ditambahkan · alasan tercatat atas nama ${s.user.displayName} · ${jam}`,
    );
  }

  if (c.type === 'final') {
    const held = store.held.get(inv.patient.rm) ?? 0;
    if (held > 0) {
      return {
        ok: false,
        message: `Finalisasi ditahan: ${held} event charge capture pasien ini masih tertahan. Selesaikan di Charge capture.`,
      };
    }
    return commit(
      { type: 'tagihan.final', invoiceId: inv.id, at },
      `Tagihan ${inv.number} difinalkan dan dikunci · ${jam}`,
    );
  }

  const lock = await periodLock(at);
  if (lock) return { ok: false, message: lock };
  const { due } = invoiceSettlement(inv);
  const st = settlementOf(inv, store.state.registered.find((r) => r.invoiceId === inv.id)?.diagnosis ?? null);
  const patient = { id: inv.patient.id, name: inv.patient.name, rm: inv.patient.rm };

  if (c.type === 'bayar') {
    if (due <= 0n) return { ok: false, message: 'Tidak ada sisa tagihan pasien; tutup kunjungan saja.' };
    if (BigInt(c.amount) !== due) {
      return {
        ok: false,
        message: `Nominal tidak sesuai sisa tagihan (${formatRupiah(due)}). Muat ulang tagihan.`,
      };
    }
    if (c.method === 'cicilan' && !c.tenor) return { ok: false, message: 'Pilih tenor cicilan BTN.' };
    if (c.method === 'transfer' && (c.transferRef ?? '').length < 6) {
      return { ok: false, message: 'Isi nomor referensi transfer (min. 6 karakter).' };
    }
    const reference = paymentReference(
      c.method,
      inv.number,
      store.state.paymentCount + 1,
      c.transferRef ?? '',
    );
    const receipt = inv.number.replace('INV', 'KW');
    return commit(
      {
        type: 'tagihan.bayar',
        invoiceId: inv.id,
        invoiceNo: inv.number,
        patient,
        method: c.method,
        amount: due.toString(),
        reference,
        tenor: c.method === 'cicilan' ? c.tenor : null,
        at,
        settlement: st,
        jurnal: [patientPaymentJournal(c.method, due, inv.number), recognition(inv, st)],
      },
      `${PAYMENT_METHOD_LABEL[c.method].name} ${formatRupiah(due)} diterima · kuitansi ${receipt} · jurnal terbentuk di Akuntansi · ${jam}`,
    );
  }

  // tutup: tanggungan pasien Rp 0 atau sudah tertutup deposit.
  if (due > 0n) {
    return { ok: false, message: `Belum bisa ditutup: pasien masih harus membayar ${formatRupiah(due)}.` };
  }
  const share = BigInt(st.patientShare);
  return commit(
    {
      type: 'tagihan.tutup',
      invoiceId: inv.id,
      invoiceNo: inv.number,
      patient,
      at,
      settlement: st,
      jurnal: [recognition(inv, st)],
    },
    share === 0n
      ? `Kunjungan ditutup, ditanggung penjamin · pasien bayar Rp 0 · jurnal pengakuan terbentuk · ${jam}`
      : `Kunjungan ditutup, tanggungan pasien ${formatRupiah(share)} lunas dari deposit · ${jam}`,
  );
}
