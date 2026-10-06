'use server';

import { type CpoeSendInput, cpoeSendInputSchema, formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { patientByEncounterId } from '@/lib/demo/fixtures/pasien';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { canWriteOrders } from '@/lib/klinis';
import { evaluateOrders, type OrderLine, SCENARIO_ORDER_NOTE } from '@/lib/klinis-cds';
import { orderDest, sentLineId } from '@/lib/klinis-order-toko';
import { getCpoeContext } from '@/lib/server/data/klinis/cpoe';
import { assertDemo } from '@/lib/server/demo-guard';
import { commitEvent, readDomain } from '@/lib/server/demo/state';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * K09 · Kirim order CPOE (mode presentasi, ADR-0023). Gerbang CDS ditegakkan ulang di server: order yang diblokir
 * tanpa alasan override sah ditolak (`CDS_BLOCKED`), bukan hanya tombol yang dinonaktifkan. Kunjungan pasien skenario
 * Simulasi ditolak (`SCENARIO_OWNED`): ordernya hanya terkirim lewat tugas langkah skenario. Order yang lolos
 * ditandatangani atas nama pengguna sesi dan tersimpan di toko demo (`klinis-order`, ADR-0085) sebagai kejadian
 * `order.ditandatangani`, yang dilanggan worklist penunjang/farmasi dan charge capture.
 */

export interface CpoeSendResult {
  ok: boolean;
  at?: string;
  count?: number;
  message?: string;
  error?: string;
  /** Tampilan basi: halaman dimuat ulang. */
  stale?: boolean;
  code?: 'CDS_BLOCKED' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'SCENARIO_OWNED' | 'STALE';
}

export async function sendOrdersAction(input: CpoeSendInput, rev: unknown): Promise<CpoeSendResult> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  if (!canWriteOrders(s.role?.code)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      error: 'Order dan resep hanya bisa ditandatangani posisi dokter.',
    };
  }
  const p = cpoeSendInputSchema.safeParse(input);
  const r = z.int().min(0).safeParse(rev);
  if (!p.success || !r.success) return { ok: false, code: 'INVALID', error: 'Daftar order tidak valid.' };
  const ctx = await getCpoeContext(s, p.data.encounterId);
  if (!ctx) return { ok: false, code: 'NOT_FOUND', error: 'Kunjungan tidak ditemukan.' };
  const patient = patientByEncounterId(ctx.encounterId);
  if (!patient || patient.scenario) {
    return {
      ok: false,
      code: 'SCENARIO_OWNED',
      error: `${SCENARIO_ORDER_NOTE}. Kirim lewat tugas langkah skenario di layar ini.`,
    };
  }
  const lines: OrderLine[] = [];
  for (const o of p.data.orders) {
    const item = ctx.catalog.find((c) => c.id === o.catalogId);
    if (!item) return { ok: false, code: 'INVALID', error: `Item katalog ${o.catalogId} tidak dikenal.` };
    lines.push({ lineId: o.catalogId, item, status: 'draf', override: o.override });
  }
  for (const sent of ctx.orders.filter((o) => o.status === 'terkirim')) {
    const item = ctx.catalog.find((c) => c.id === sent.catalogId);
    if (item) lines.push({ lineId: `terkirim-${sent.id}`, item, status: 'terkirim', override: null });
  }
  const cdsPatient = {
    allergies: ctx.patient.allergies,
    activeMeds: ctx.activeMeds,
    flags: ctx.flags,
    egfr: ctx.egfr,
    payer: ctx.patient.payer,
  };
  const evaluated = evaluateOrders(lines, cdsPatient, ctx.doctor);
  const blocked = evaluated.filter((l) => l.status === 'draf' && l.blocked);
  if (blocked.length > 0) {
    return {
      ok: false,
      code: 'CDS_BLOCKED',
      error: `Ditolak CDS: ${blocked.map((l) => l.item.name).join(', ')} masih diblokir. Ganti, hapus, atau isi alasan override.`,
    };
  }
  const { state } = await readDomain('klinis-order');
  const seq = state.batches.length + 1;
  const now = demoNow();
  const drafts = evaluated.filter((l) => l.status === 'draf');
  const c = await commitEvent(
    'klinis-order',
    {
      type: 'order.ditandatangani',
      encounterId: ctx.encounterId,
      patientId: patient.id,
      rm: patient.rm,
      patientName: patient.nama,
      setting: ctx.setting,
      payer: ctx.patient.payer,
      signedAt: wib(now),
      lines: drafts.map((l) => ({
        lineId: sentLineId(ctx.encounterId, seq, l.item.id),
        catalogId: l.item.id,
        kind: l.item.kind,
        name: l.item.name,
        detail: l.item.detail,
        code: l.item.code,
        coverage: l.item.coverage,
        priority: l.item.priority,
        tariff: l.item.tariff,
        // Alasan override hanya tercatat bila CDS memang memblokir (diperiksa ulang di atas).
        override: l.overridden ? l.override : null,
        dest: orderDest(l.item.kind),
      })),
    },
    { rev: r.data, session: s },
  );
  if (!c.ok) return { ok: false, code: c.stale ? 'STALE' : 'INVALID', error: c.error, stale: c.stale };
  const at = formatJam(now);
  return {
    ok: true,
    at,
    count: p.data.orders.length,
    message: `Ditandatangani ${s.user.displayName} dengan TTE. Order sudah masuk antrean unit penerima.`,
  };
}
