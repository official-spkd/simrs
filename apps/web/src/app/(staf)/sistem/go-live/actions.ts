'use server';

import { goLiveEventSchema, type GoLiveEvent } from '@/lib/golive-toko';
import { frontOfficeActionSession } from '@/lib/server/data/front-office/shared';
import { commitEvent, readDomain } from '@/lib/server/demo/state';
import type { SessionView } from '@/lib/session-view';

/**
 * Fase 10 · Server Action Kesiapan go-live mode presentasi (ADR-0023/0085). Centang/pemilik item adalah nilai
 * tetap (bukan selisih) dan keputusan diperiksa ulang penuh di toko (item kritis tersimpan + posisi Manajemen), jadi
 * kejadian dicatat terhadap revisi TERKINI domain `golive` (bukan revisi tampilan): centang beruntun lalu keputusan
 * tidak saling menolak sebagai basi, sementara semua gerbang tetap ditegakkan toko dengan pelaku dari sesi.
 */

type Result = { ok: boolean; message: string };

async function commitLatest(s: SessionView, event: GoLiveEvent): Promise<Result> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { rev } = await readDomain('golive');
    const r = await commitEvent('golive', event, { rev, session: s });
    if (r.ok) return { ok: true, message: 'Tersimpan' };
    if (!r.stale) return { ok: false, message: r.error };
  }
  return { ok: false, message: 'Ceklis sedang diubah di perangkat lain. Coba lagi.' };
}

const DENIED: Result = { ok: false, message: 'Posisi Anda tidak memakai layar Kesiapan go-live.' };

/** Centang dan/atau pemilik satu item ceklis. */
export async function setGoLiveItemAction(input: unknown): Promise<Result> {
  const s = await frontOfficeActionSession('golive');
  if (!s) return DENIED;
  const p = goLiveEventSchema.safeParse({ ...(input as object), type: 'item.diubah' });
  if (!p.success || p.data.type !== 'item.diubah')
    return { ok: false, message: 'Isian ceklis tidak dikenali.' };
  return commitLatest(s, p.data);
}

/** Keputusan go/no-go (hanya posisi Manajemen; GO terkunci sampai item kritis tersimpan selesai + berpemilik). */
export async function decideGoLiveAction(input: unknown): Promise<Result> {
  const s = await frontOfficeActionSession('golive');
  if (!s) return DENIED;
  const p = goLiveEventSchema.safeParse({ ...(input as object), type: 'keputusan.diambil' });
  if (!p.success || p.data.type !== 'keputusan.diambil')
    return { ok: false, message: 'Keputusan tidak dikenali.' };
  return commitLatest(s, p.data);
}

/** Buka kembali keputusan (hanya posisi Manajemen). */
export async function reopenGoLiveAction(input: unknown): Promise<Result> {
  const s = await frontOfficeActionSession('golive');
  if (!s) return DENIED;
  const p = goLiveEventSchema.safeParse({ ...(input as object), type: 'keputusan.dibuka' });
  if (!p.success || p.data.type !== 'keputusan.dibuka')
    return { ok: false, message: 'Permintaan tidak dikenali.' };
  return commitLatest(s, p.data);
}
