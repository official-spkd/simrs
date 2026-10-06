import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { DEMO_REFERRALS } from './demo/fixtures/rujukan';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { canCancel, canResend, type DemoReferral, kindLabel, processSync, resend } from './rujukan';

/**
 * F07 · Domain toko demo `rujukan` (ADR-0085): proses antrean kirim (mock BPJS), perbaiki lalu kirim ulang, cetak,
 * dan batal beralasan untuk rujukan, surat kontrol, dan SPRI. Hasil antrean kirim mengikuti `simOutcome` fixture
 * (deterministik), aturan murni → `generic`. Nomor yang terbit (`antrean.diproses` dengan status `active`) bisa
 * dilanggan meja pendaftaran kelak (surat kontrol baru dipakai SEP).
 */

export const REFERRAL_DOMAIN = 'rujukan';

const refId = z.string().min(1).max(60);
const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);

export const referralEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('antrean.diproses'),
    id: refId,
    at: z.iso.datetime({ offset: true }),
    jam,
  }),
  z.strictObject({
    type: z.literal('kirim.ulang'),
    id: refId,
    newPlannedDate: z.iso.date().nullable(),
    jam,
  }),
  z.strictObject({ type: z.literal('surat.dicetak'), id: refId, jam }),
  z.strictObject({ type: z.literal('rujukan.dibatalkan'), id: refId, reason: z.string().max(300), jam }),
]);
export type ReferralEvent = z.infer<typeof referralEventSchema>;

export interface ReferralStoreState {
  referrals: readonly DemoReferral[];
  log: ReadonlyArray<{ t: string; text: string }>;
}

const DATE_ISSUES = ['BPJS_TANGGAL_TIDAK_VALID', 'BPJS_JADWAL_LIBUR', 'BPJS_KUOTA_PENUH'];

/** Nomor fiktif saat kirim ulang berhasil (per jenis surat). */
function resendNumber(r: DemoReferral): string {
  if (r.kind === 'spri') return '0301R0011025S000019';
  if (r.kind === 'rujukan-keluar') return '0301R0011025B000007';
  return '0301R0011025K000099';
}

function gate(s: ReferralStoreState, ev: ReferralEvent): string | null {
  const r = s.referrals.find((x) => x.id === ev.id);
  if (!r) return 'Rujukan tidak ditemukan.';
  switch (ev.type) {
    case 'antrean.diproses':
      return r.sync.status === 'pending' && r.status === 'pending'
        ? null
        : 'Tidak ada kiriman yang menunggu.';
    case 'kirim.ulang': {
      if (r.status === 'cancelled') return 'Rujukan sudah dibatalkan.';
      const needsDate = DATE_ISSUES.includes(r.sync.error?.code ?? '');
      const c = canResend(r, needsDate ? ev.newPlannedDate : null, DEMO_TODAY);
      return c.ok ? null : c.reason;
    }
    case 'surat.dicetak':
      return r.status === 'active' || r.status === 'used'
        ? null
        : 'Surat belum bernomor; belum bisa dicetak.';
    case 'rujukan.dibatalkan': {
      if (ev.reason.trim().length < 5) return 'Alasan pembatalan wajib diisi.';
      const c = canCancel(r);
      return c.ok ? null : c.reason;
    }
  }
}

export const referralDomain = defineDomain<ReferralStoreState, ReferralEvent>(REFERRAL_DOMAIN, {
  initial: () => ({ referrals: [...DEMO_REFERRALS], log: [] }),
  eventSchema: referralEventSchema,
  screens: ['rujukan'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    const r = s.referrals.find((x) => x.id === d.id) as DemoReferral;
    const put = (next: DemoReferral, text: string): ReferralStoreState => ({
      referrals: s.referrals.map((x) => (x.id === next.id ? next : x)),
      log: [{ t: d.jam, text: `${text} (${ev.actor.name})` }, ...s.log],
    });
    switch (d.type) {
      case 'antrean.diproses': {
        const next = processSync(r, d.at);
        return put(
          next,
          next.sync.status === 'sent'
            ? `Nomor BPJS terbit ${next.number}`
            : `Ditolak BPJS: ${next.sync.error?.message ?? ''}`,
        );
      }
      case 'kirim.ulang': {
        const needsDate = DATE_ISSUES.includes(r.sync.error?.code ?? '');
        return put(
          resend(r, needsDate ? d.newPlannedDate : null, resendNumber(r)),
          'Dikirim ulang ke antrean BPJS',
        );
      }
      case 'surat.dicetak':
        return put(r, `Surat ${r.number} dicetak · tercatat audit`);
      case 'rujukan.dibatalkan':
        return put(
          { ...r, status: 'cancelled', cancelReason: d.reason.trim() },
          `${kindLabel(r.kind)} dibatalkan`,
        );
    }
  },
});
