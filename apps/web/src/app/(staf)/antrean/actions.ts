'use server';

import { callResultSchema, counterLabelSchema, queueTicketSchema } from '@simrs/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { can, nextLoginStep } from '@/lib/session-view';

/**
 * F04 · Server Action Kendali antrean (fase 2 potongan 4b): sesi + izin `queue.call` diperiksa di sini (pesan jelas)
 * dan ditegakkan API (lingkup unit klinisi, transisi status, tiket milik RS). Setiap panggilan tercatat di
 * `queue_calls` dan disiarkan ke TV oleh API; task ID BPJS dibentuk dari event domain, bukan dari tombol ini.
 */

const PATH = '/antrean';

export interface QueueActionResult {
  ok: boolean;
  message: string;
}

async function authorize(): Promise<QueueActionResult | null> {
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return can(s, 'queue', 'call')
    ? null
    : { ok: false, message: 'Peran Anda tidak berizin memanggil antrean.' };
}

function failure(err: unknown): QueueActionResult {
  if (err instanceof ApiError) {
    if (err.status === 401) redirect('/masuk');
    return { ok: false, message: err.message };
  }
  return { ok: false, message: 'Terjadi kesalahan. Coba lagi.' };
}

const serviceInput = z.strictObject({ serviceId: z.uuid() });
const callNextInput = z.strictObject({ serviceId: z.uuid(), counter: counterLabelSchema });
const ticketInput = z.discriminatedUnion('action', [
  z.strictObject({ ticketId: z.uuid(), action: z.enum(['call', 'recall']), counter: counterLabelSchema }),
  z.strictObject({ ticketId: z.uuid(), action: z.enum(['start', 'finish', 'skip']) }),
]);

/** Terbitkan nomor baru di layanan ini (pasien datang langsung ke loket, tanpa booking). */
export async function issueTicketAction(input: unknown): Promise<QueueActionResult> {
  const denied = await authorize();
  if (denied) return denied;
  const p = serviceInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Layanan tidak dikenali. Muat ulang halaman.' };
  try {
    const t = await api(`/api/v1/queue/services/${p.data.serviceId}/tickets`, {
      method: 'POST',
      body: {},
      schema: queueTicketSchema,
    });
    revalidatePath(PATH);
    return { ok: true, message: `Nomor ${t.queueNo} diterbitkan.` };
  } catch (err) {
    return failure(err);
  }
}

/** Panggil nomor berikutnya (FIFO, nomor cadangan booking dilewati) ke loket/ruang ini. */
export async function callNextAction(input: unknown): Promise<QueueActionResult> {
  const denied = await authorize();
  if (denied) return denied;
  const p = callNextInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Pilih loket atau ruang pemanggil.' };
  try {
    const r = await api(`/api/v1/queue/services/${p.data.serviceId}/call-next`, {
      method: 'POST',
      body: { counter: p.data.counter },
      schema: callResultSchema,
    });
    revalidatePath(PATH);
    return { ok: true, message: `${r.ticket.queueNo} dipanggil ke ${p.data.counter}.` };
  } catch (err) {
    return failure(err);
  }
}

const DONE: Record<'call' | 'recall' | 'start' | 'finish' | 'skip', (no: string, at: string) => string> = {
  call: (no, at) => `${no} dipanggil ke ${at}.`,
  recall: (no, at) => `${no} dipanggil ulang ke ${at}.`,
  start: (no) => `${no} mulai dilayani.`,
  finish: (no) => `${no} selesai dilayani.`,
  skip: (no) => `${no} dilewati; bisa dipanggil lagi bila pasien datang.`,
};

/** Aksi satu tiket: panggil/panggil ulang (dengan loket), mulai layani, selesai, lewati. */
export async function ticketAction(input: unknown): Promise<QueueActionResult> {
  const denied = await authorize();
  if (denied) return denied;
  const p = ticketInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Aksi antrean tidak dikenali. Muat ulang halaman.' };
  const d = p.data;
  const counter = 'counter' in d ? d.counter : '';
  try {
    const r = await api(`/api/v1/queue/tickets/${d.ticketId}/${d.action}`, {
      method: 'POST',
      body: 'counter' in d ? { counter: d.counter } : {},
      schema: callResultSchema,
    });
    revalidatePath(PATH);
    return { ok: true, message: DONE[d.action](r.ticket.queueNo, counter || (r.call.counter ?? '')) };
  } catch (err) {
    return failure(err);
  }
}
