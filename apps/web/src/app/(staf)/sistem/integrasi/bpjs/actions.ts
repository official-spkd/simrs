'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { demoBookings, demoHfis } from '@/lib/demo/fixtures/integrasi-bpjs';
import { downtimeGate, resendInOrder } from '@/lib/integrasi-bpjs';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';

/**
 * I03 · Server Action konektor BPJS (mode presentasi, ADR-0023): kirim ulang task ID berurutan (berkonfirmasi),
 * sinkron Aplicare, pembaruan jadwal HFIS, serta mulai/akhiri mode downtime (alasan wajib). Tidak ada yang dikirim
 * ke BPJS atau disimpan; produksi memasukkan pesan ke outbox dan mencatat jejak audit.
 */

export interface BpjsActionResult {
  ok: boolean;
  message: string;
  at?: string;
}

const input = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('task'),
    bookingCode: z.string().regex(/^\d{10}$/),
    confirmed: z.literal(true),
  }),
  z.strictObject({ kind: z.literal('aplicare') }),
  z.strictObject({ kind: z.literal('hfis'), doctor: z.string().max(120) }),
  z.strictObject({ kind: z.literal('downtime-mulai'), reason: z.string().max(300) }),
  z.strictObject({ kind: z.literal('downtime-akhiri'), backlog: z.number().int().min(0).max(10_000) }),
]);

const sim = (text: string): BpjsActionResult => {
  const at = formatJam(new Date());
  return { ok: true, at, message: `${text} · ${at} (simulasi, tidak disimpan)` };
};

export async function bpjsAction(raw: unknown): Promise<BpjsActionResult> {
  if (!(await manajemenSession('bpjs'))) return { ok: false, message: DENIED_MESSAGE };
  const p = input.safeParse(raw);
  if (!p.success) return { ok: false, message: 'Permintaan tidak dikenal (kirim ulang wajib dikonfirmasi).' };
  const a = p.data;
  switch (a.kind) {
    case 'task': {
      const b = demoBookings().find((x) => x.bookingCode === a.bookingCode);
      if (!b) return { ok: false, message: 'Kode booking tidak ditemukan.' };
      const { sent } = resendInOrder(b, new Date().toISOString());
      if (sent.length === 0) return { ok: false, message: 'Tidak ada task ID yang gagal untuk booking ini.' };
      return sim(
        `Task ${sent.join(' lalu ')} booking ${b.bookingCode} dikirim berurutan → diterima BPJS, tercatat di jejak audit`,
      );
    }
    case 'aplicare':
      return sim('Ketersediaan tempat tidur semua kelas dikirim ke Aplicare');
    case 'hfis': {
      const row = demoHfis().find((r) => r.doctor === a.doctor);
      if (!row) return { ok: false, message: 'Dokter tidak ada di daftar HFIS.' };
      return sim(`Jadwal ${row.doctor} (${row.simrs}) dikirim ke HFIS`);
    }
    case 'downtime-mulai': {
      const err = downtimeGate(a.reason);
      if (err) return { ok: false, message: err };
      return sim(`Mode downtime BPJS aktif: “${a.reason.trim()}” · tercatat di jejak audit`);
    }
    case 'downtime-akhiri':
      return sim(
        `Mode downtime diakhiri · ${a.backlog} transaksi tertunda disinkronkan berurutan tanpa duplikasi`,
      );
  }
}
