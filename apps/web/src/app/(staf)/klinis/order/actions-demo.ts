'use server';

import { type CpoeSendInput, cpoeSendInputSchema, formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { patientByEncounterId } from '@/lib/demo/fixtures/pasien';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { canWriteOrders } from '@/lib/klinis';
import { evaluateOrders, type OrderLine, SCENARIO_ORDER_NOTE } from '@/lib/klinis-cds';
import { getCpoeContext } from '@/lib/server/data/klinis/cpoe';
import { assertDemo } from '@/lib/server/demo-guard';
import { getSession } from '@/lib/server/session';
import { nextLoginStep } from '@/lib/session-view';

/**
 * K09 · Kirim order CPOE (mode presentasi, ADR-0023). Gerbang CDS ditegakkan ulang di server: order yang diblokir
 * tanpa alasan override sah ditolak (`CDS_BLOCKED`), bukan hanya tombol yang dinonaktifkan. Kunjungan pasien skenario
 * Simulasi ditolak (`SCENARIO_OWNED`): ordernya hanya terkirim lewat tugas langkah skenario. Tidak menyimpan apa pun.
 */

export interface CpoeSendResult {
  ok?: true;
  at?: string;
  count?: number;
  message?: string;
  error?: string;
  code?: 'CDS_BLOCKED' | 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'SCENARIO_OWNED';
}

export async function sendOrdersAction(input: CpoeSendInput): Promise<CpoeSendResult> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  if (!canWriteOrders(s.role?.code)) {
    return { code: 'FORBIDDEN', error: 'Order dan resep hanya bisa ditandatangani posisi dokter.' };
  }
  const p = cpoeSendInputSchema.safeParse(input);
  if (!p.success) return { code: 'INVALID', error: 'Daftar order tidak valid.' };
  const ctx = await getCpoeContext(s, p.data.encounterId);
  if (!ctx) return { code: 'NOT_FOUND', error: 'Kunjungan tidak ditemukan.' };
  if (patientByEncounterId(ctx.encounterId)?.scenario) {
    return {
      code: 'SCENARIO_OWNED',
      error: `${SCENARIO_ORDER_NOTE}. Kirim lewat tugas langkah skenario di layar ini.`,
    };
  }
  const lines: OrderLine[] = [];
  for (const o of p.data.orders) {
    const item = ctx.catalog.find((c) => c.id === o.catalogId);
    if (!item) return { code: 'INVALID', error: `Item katalog ${o.catalogId} tidak dikenal.` };
    lines.push({ lineId: o.catalogId, item, status: 'draf', override: o.override });
  }
  for (const sent of ctx.orders.filter((o) => o.status === 'terkirim')) {
    const item = ctx.catalog.find((c) => c.id === sent.catalogId);
    if (item) lines.push({ lineId: `terkirim-${sent.id}`, item, status: 'terkirim', override: null });
  }
  const patient = {
    allergies: ctx.patient.allergies,
    activeMeds: ctx.activeMeds,
    flags: ctx.flags,
    egfr: ctx.egfr,
    payer: ctx.patient.payer,
  };
  const blocked = evaluateOrders(lines, patient, ctx.doctor).filter((l) => l.status === 'draf' && l.blocked);
  if (blocked.length > 0) {
    return {
      code: 'CDS_BLOCKED',
      error: `Ditolak CDS: ${blocked.map((l) => l.item.name).join(', ')} masih diblokir. Ganti, hapus, atau isi alasan override.`,
    };
  }
  const at = formatJam(demoNow());
  const count = p.data.orders.length;
  return {
    ok: true,
    at,
    count,
    message: `${count} order terkirim pukul ${at} · ditandatangani ${s.user.displayName} (TTE) (simulasi, tidak disimpan)`,
  };
}
