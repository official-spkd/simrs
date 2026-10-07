'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import { KEEP_REASON_MIN, VERSION_REASON_MIN } from '@/lib/keuangan-koding';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
} from '@/lib/server/data/keuangan-toko';
import { codingList } from '@/lib/keuangan-klaim-toko';
import { commitEvent, readDomain } from '@/lib/server/demo/state';

/**
 * U06 · Server Action Workbench koder (mode presentasi, ADR-0085): tautan bukti, alasan pertahankan, keputusan saran,
 * hapus kode pada versi baru, query + jawaban DPJP (disimulasikan), pengingat, dan validasi/versi koding tersimpan di
 * domain toko `klaim` atas nama pengguna sesi. Gerbang (`validateBerkas`, `versionProblem`, bukti dari RME pasien)
 * ditegakkan domain; klien hanya mengirim id dan teks.
 */

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rev = z.number().int().min(0);
const reason = z.string().trim().min(KEEP_REASON_MIN).max(300);
const kodingPatchSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('bukti'), evidenceId: id }),
  z.strictObject({ op: z.literal('alasan'), reason }),
  z.strictObject({ op: z.literal('terima') }),
  z.strictObject({ op: z.literal('tolak'), reason }),
  z.strictObject({ op: z.literal('hapus') }),
]);
export type KodingPatch = z.infer<typeof kodingPatchSchema>;

const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('kode'), berkasId: id, codeId: id, patch: kodingPatchSchema, rev }),
  z.strictObject({
    type: z.literal('query'),
    berkasId: id,
    question: z.string().trim().min(20).max(500),
    rev,
  }),
  z.strictObject({ type: z.literal('jawaban'), berkasId: id, rev }),
  z.strictObject({ type: z.literal('pengingat'), berkasId: id, rev }),
  z.strictObject({
    type: z.literal('selesai'),
    berkasId: id,
    versionReason: z.string().trim().max(300).nullable(),
    rev,
  }),
]);
export type KodingActionInput = z.infer<typeof inputSchema>;

const PATCH_MESSAGE: Record<KodingPatch['op'], string> = {
  bukti: 'Bukti klinis tertaut',
  alasan: 'Kode dipertahankan dengan alasan',
  terima: 'Saran kode diterima',
  tolak: 'Saran kode ditolak dengan alasan',
  hapus: 'Kode dihapus pada versi koding baru',
};

export async function kodingAction(input: KodingActionInput): Promise<KeuanganActionResult> {
  const s = await keuanganSession('koding');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const commit = async (event: EventOf<'klaim'>, message: string): Promise<KeuanganActionResult> => {
    const r = await commitEvent('klaim', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message, rev: r.rev } : { ok: false, message: r.error, stale: r.stale };
  };
  const { state } = await readDomain('klaim');
  const b = codingList(state).find((x) => x.id === c.berkasId);
  switch (c.type) {
    case 'kode':
      return commit(
        { type: 'koding.kode', berkasId: c.berkasId, codeId: c.codeId, patch: c.patch, at },
        `${PATCH_MESSAGE[c.patch.op]} · ${jam}`,
      );
    case 'query':
      return commit(
        { type: 'koding.query', berkasId: c.berkasId, question: c.question, at },
        `Query dikirim ke ${b?.dpjp ?? 'DPJP'} · ${jam}`,
      );
    case 'jawaban':
      return commit(
        { type: 'koding.jawaban', berkasId: c.berkasId, at },
        `DPJP menjawab query ${b?.patient.name ?? ''} · ${jam} · bukti addendum tertaut ke ${b?.query?.confirms ?? ''}`,
      );
    case 'pengingat':
      return commit(
        { type: 'koding.pengingat', berkasId: c.berkasId, at },
        `Pengingat query dikirim ke ${b?.query?.to ?? 'DPJP'} · ${jam}`,
      );
    case 'selesai':
      if (
        c.versionReason !== null &&
        c.versionReason.length > 0 &&
        c.versionReason.length < VERSION_REASON_MIN
      ) {
        return { ok: false, message: `Tulis alasan versi baru (min. ${VERSION_REASON_MIN} karakter).` };
      }
      return commit(
        { type: 'koding.selesai', berkasId: c.berkasId, versionReason: c.versionReason, at },
        b?.sent
          ? `Versi koding ${(b.versions.at(-1)?.version ?? 1) + 1} ${b.patient.name} disimpan · ${jam} · tanggapan siap dikirim dari Klaim & koding`
          : `Koding ${b?.patient.name ?? ''} tervalidasi · ${jam} · diteruskan ke grouper di Klaim & koding`,
      );
  }
}
