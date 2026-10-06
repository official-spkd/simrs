'use server';

import { dlqResendInputSchema, formatJam } from '@simrs/shared';
import { DEAD_LETTERS, INTERFACE_NAME } from '@/lib/demo/fixtures/manajemen';
import { dlqNeedsFix } from '@/lib/manajemen';
import { DENIED_MESSAGE, manajemenSession } from '@/lib/manajemen-aksi';

/**
 * Server Action integration hub (mode presentasi, ADR-0023): gerbang demo, sesi lengkap, posisi pemakai layar
 * `integrasi`, input zod. Tidak ada yang disimpan atau dikirim ke sistem luar; produksi kelak memasukkan ulang
 * pesan ke outbox dengan kunci idempotensi yang sama.
 */

export interface ResendResult {
  ok: boolean;
  message: string;
  ids: string[];
}

export async function resendDeadLettersAction(input: unknown): Promise<ResendResult> {
  if (!(await manajemenSession('integrasi'))) return { ok: false, message: DENIED_MESSAGE, ids: [] };
  const parsed = dlqResendInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Pilihan pesan tidak dikenal.', ids: [] };
  const known = new Map(DEAD_LETTERS.map((d) => [d.id, d]));
  const ids = [...new Set(parsed.data.ids)];
  const picked = ids.map((id) => known.get(id));
  if (picked.some((d) => d === undefined)) {
    return { ok: false, message: 'Sebagian pesan sudah tidak ada di antrean. Muat ulang halaman.', ids: [] };
  }
  if (picked.some((d) => d && dlqNeedsFix(d))) {
    return {
      ok: false,
      message: 'Pesan bergalat permanen tidak dikirim ulang sebelum datanya diperbaiki.',
      ids: [],
    };
  }
  const targets = [...new Set(picked.flatMap((d) => (d ? [INTERFACE_NAME[d.target]] : [])))].join(', ');
  return {
    ok: true,
    ids,
    message: `${ids.length} pesan dikirim ulang ke ${targets} pukul ${formatJam(new Date())} lewat outbox dengan kunci idempotensi yang sama · diterima tujuan, dikeluarkan dari antrean, dan tercatat di log audit (simulasi, tidak disimpan).`,
  };
}
