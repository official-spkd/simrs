'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import type { EventOf } from '@/lib/demo/store/registry';
import { codingView, missingDocs } from '@/lib/keuangan-klaim';
import { getClaimStore } from '@/lib/server/data/keuangan';
import {
  BAD_INPUT,
  demoStamp,
  keuanganSession,
  type KeuanganActionResult,
  NOT_YOUR_SCREEN,
} from '@/lib/server/data/keuangan-toko';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * Server Action Klaim mode presentasi (ADR-0023/0085): gerbang demo, sesi lengkap, posisi koder, input zod. Tindakan
 * koder tersimpan di domain toko `klaim` atas nama pengguna sesi. Kirim E-Klaim diperiksa ulang di server terhadap
 * berkas versi server (kelengkapan dokumen + hasil grouper), bukan tanda dari klien. Hasil verifikasi BPJS
 * disimulasikan (mock E-Klaim) dan mengalirkan klaim layak bayar ke Pembiayaan BTN. Klaim pasien skenario dimajukan
 * lewat mesin skenario (`demoCommandAction`).
 */

export type KlaimActionResult = KeuanganActionResult;

const claimId = z.string().regex(/^[a-z0-9-]{1,60}$/);
const rev = z.number().int().min(0);
const inputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('kirim'), claimId, rev }),
  z.strictObject({ type: z.literal('tanggapan'), claimId, rev }),
  z.strictObject({ type: z.literal('banding'), claimId, rev }),
  z.strictObject({ type: z.literal('query'), claimId, rev }),
  z.strictObject({
    type: z.literal('terima-saran'),
    claimId,
    code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
    rev,
  }),
  z.strictObject({
    type: z.literal('berkas'),
    claimId,
    docId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    ok: z.boolean(),
    rev,
  }),
  z.strictObject({
    type: z.literal('alasan-bukti'),
    claimId,
    reason: z.string().trim().min(10).max(500),
    rev,
  }),
  z.strictObject({ type: z.literal('verifikasi'), claimId, rev }),
]);
export type KlaimActionInput = z.infer<typeof inputSchema>;

export async function klaimAction(input: KlaimActionInput): Promise<KlaimActionResult> {
  const s = await keuanganSession('klaim');
  if (!s) return { ok: false, message: NOT_YOUR_SCREEN };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_INPUT };
  const c = parsed.data;
  const at = demoStamp();
  const jam = formatJam(at);
  const commit = async (event: EventOf<'klaim'>, message: string): Promise<KlaimActionResult> => {
    const r = await commitEvent('klaim', event, { rev: c.rev, session: s });
    return r.ok ? { ok: true, message, rev: r.rev } : { ok: false, message: r.error, stale: r.stale };
  };
  if (c.type === 'alasan-bukti') {
    return commit(
      { type: 'klaim.alasan', claimId: c.claimId, reason: c.reason, at },
      `Alasan ketidaksesuaian kode tercatat atas nama ${s.user.displayName} dan dapat ditinjau · ${jam}`,
    );
  }
  const { board, state } = await getClaimStore(s);
  const claim = board.claims.find((x) => x.id === c.claimId);
  if (!claim) return { ok: false, message: 'Klaim tidak ditemukan.' };
  switch (c.type) {
    case 'berkas':
      return commit(
        { type: 'klaim.berkas', claimId: claim.id, docId: c.docId, ok: c.ok, at },
        `Kelengkapan berkas diperbarui · ${jam}`,
      );
    case 'query':
      return commit({ type: 'klaim.query', claimId: claim.id, at }, `Query koder terkirim ke DPJP · ${jam}`);
    case 'terima-saran':
      return commit(
        { type: 'klaim.saran', claimId: claim.id, code: c.code, at },
        `Saran koding diterima, grouper dihitung ulang · ${jam}`,
      );
    case 'kirim':
    case 'tanggapan':
    case 'banding': {
      const local = state.local[claim.id] ?? {};
      const docs = claim.documents;
      const view = codingView(claim, { accepted: !!local.acceptedAt, docs });
      const missing = missingDocs(docs);
      if (missing.length)
        return { ok: false, message: `Belum bisa dikirim: lengkapi ${missing.join('; ')}.` };
      if (!view.grouper)
        return { ok: false, message: 'Grouping ditahan; selesaikan tindak lanjut lebih dulu.' };
      return commit(
        { type: 'klaim.kirim', claimId: claim.id, kind: c.type, at },
        c.type === 'kirim'
          ? `Grouping final dan terkirim ke E-Klaim (mock) · ${jam}`
          : c.type === 'tanggapan'
            ? `Tanggapan dan berkas tambahan terkirim ke verifikator · ${jam}`
            : `Banding (penyelesaian dispute) diajukan · ${jam}`,
      );
    }
    case 'verifikasi': {
      const local = state.local[claim.id] ?? {};
      const g = codingView(claim, { accepted: !!local.acceptedAt, docs: claim.documents }).grouper;
      if (!g) return { ok: false, message: 'Klaim tanpa hasil grouper tidak bisa diverifikasi.' };
      return commit(
        {
          type: 'klaim.verifikasi',
          claimId: claim.id,
          patient: { id: claim.patient.id, name: claim.patient.name, rm: claim.patient.rm },
          sep: claim.encounter.sep,
          kind: claim.encounter.kind,
          amount: g.tariff,
          at,
        },
        `Verifikator BPJS (mock E-Klaim): layak bayar · klaim masuk pool Pembiayaan BTN · ${jam}`,
      );
    }
  }
}
