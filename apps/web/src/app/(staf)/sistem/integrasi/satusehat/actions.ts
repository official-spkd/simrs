'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { demoSatusehatVisits } from '@/lib/demo/fixtures/integrasi-satusehat';
import { resendGate } from '@/lib/integrasi-satusehat';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';

/**
 * I02 · Server Action konektor SATUSEHAT (mode presentasi, ADR-0023): lookup IHS lewat NIK tervalidasi, perbaikan
 * pemetaan kode, dan kirim ulang pesan DLQ berkonfirmasi. Kunjungan dan resource dicari server dari fixture; tidak
 * ada yang dikirim ke SATUSEHAT atau disimpan. Produksi: kirim ulang memasukkan pesan ke outbox dengan kunci
 * idempotensi yang sama dan tercatat di jejak audit.
 */

export interface SatusehatActionResult {
  ok: boolean;
  message: string;
  at?: string;
}

const id = z.string().min(1).max(40);
const input = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ihs'), visitId: id }),
  z.strictObject({ kind: z.literal('petakan'), visitId: id, resourceId: id }),
  z.strictObject({
    kind: z.literal('kirim-ulang'),
    visitId: id,
    resourceId: id,
    confirmed: z.literal(true),
    fixed: z.strictObject({ ihs: z.boolean(), loinc: z.boolean(), kfa: z.boolean() }),
  }),
]);

const fail = (message: string): SatusehatActionResult => ({ ok: false, message });

export async function satusehatAction(raw: unknown): Promise<SatusehatActionResult> {
  if (!(await manajemenSession('satusehat'))) return fail(DENIED_MESSAGE);
  const p = input.safeParse(raw);
  if (!p.success) return fail('Permintaan tidak dikenal (kirim ulang wajib dikonfirmasi).');
  const a = p.data;
  const v = demoSatusehatVisits().find((x) => x.id === a.visitId);
  if (!v) return fail('Kunjungan tidak ditemukan.');
  const at = formatJam(new Date());
  if (a.kind === 'ihs') {
    if (v.patient.ihs) return fail('Pasien ini sudah punya IHS terverifikasi.');
    return {
      ok: true,
      at,
      message: `IHS ${v.patient.name} ditemukan lewat NIK tervalidasi Dukcapil · ${at} · disimpan terenkripsi (simulasi, tidak disimpan)`,
    };
  }
  const r = v.resources.find((x) => x.id === a.resourceId);
  if (!r?.error) return fail('Pesan tidak ada di DLQ.');
  if (a.kind === 'petakan') {
    if (r.error.fix !== 'loinc') return fail('Perbaikan ini bukan pemetaan kode lab.');
    return {
      ok: true,
      at,
      message: `${r.error.fixLabel} · berlaku untuk pesan berikutnya · ${at} (simulasi, tidak disimpan)`,
    };
  }
  const gate = resendGate(r, a.fixed);
  if (gate === 'FIX_BLOCKED') return fail(r.error.blockedReason ?? 'Perbaikan belum bisa dilakukan.');
  if (gate === 'FIX_REQUIRED')
    return fail(`Perbaiki data dulu: ${r.error.fixLabel}. Kirim ulang tanpa perbaikan akan gagal lagi.`);
  return {
    ok: true,
    at,
    message: `${r.type} ${v.encounterNo} dikirim ulang ${at} → 201 Created · kunci idempotensi sama · tercatat di jejak audit (simulasi, tidak disimpan)`,
  };
}
