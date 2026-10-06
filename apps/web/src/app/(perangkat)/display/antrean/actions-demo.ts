'use server';

import { wallClockSchema } from '@simrs/shared';
import { z } from 'zod';
import { nextPoliCall } from '@/lib/front-office-antrean';
import { frontOfficeActionSession } from '@/lib/server/data/front-office/shared';
import { boardOf, commitFresh } from '@/lib/server/data/front-office/toko';

/**
 * F04 · Server Action papan antrean MODE PRESENTASI (ADR-0023/0085): "Panggil berikutnya" (dan panggilan otomatis
 * presenter) memanggil nomor poli berikutnya secara bergiliran. Nomor dihitung server dari antrean terkini lalu
 * tersimpan di toko demo (domain `antrean`, kejadian `antrean.dipanggil` = kontrak untuk Poli). Jalur api papan
 * (SSE perangkat) tidak tersentuh.
 */

export interface DisplayDemoResult {
  ok: boolean;
  message: string;
  queueNo?: string;
  /** Tidak ada nomor yang bisa dipanggil lagi (panggilan otomatis berhenti). */
  empty?: boolean;
}

const EMPTY = 'Semua antrean poli di papan ini sudah dipanggil.';

export async function callNextPoliAction(input: unknown): Promise<DisplayDemoResult> {
  const s = await frontOfficeActionSession('antrean');
  if (!s) return { ok: false, message: 'Posisi Anda tidak memakai layar Display antrean.' };
  const p = z.strictObject({ jam: wallClockSchema }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Panggilan tidak dikenali.' };
  const r = await commitFresh(s, 'antrean', (fo) => {
    const next = nextPoliCall(boardOf(fo));
    if (!next) return EMPTY;
    return {
      type: 'antrean.dipanggil' as const,
      queueNo: next.queueNo,
      poliCode: next.poliCode,
      via: 'display' as const,
      jam: p.data.jam,
    };
  });
  if (!r.ok) return { ok: false, message: r.error, empty: r.error === EMPTY };
  const no = r.event.type === 'antrean.dipanggil' ? r.event.queueNo : '';
  return { ok: true, queueNo: no, message: `${no} dipanggil · ${p.data.jam}` };
}
