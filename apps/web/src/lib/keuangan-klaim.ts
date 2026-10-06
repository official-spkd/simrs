import { type Claim, type ClaimStatus, formatRupiah } from '@simrs/shared';
import type { ViewTone } from './keuangan';

/** U05/U06 · Format dan aturan tampilan Klaim (murni; dipakai server dan klien). */

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: 'Perlu koding',
  sent: 'Terkirim',
  pending: 'Pending BPJS',
  payable: 'Layak bayar',
  dispute: 'Dispute',
  paid: 'Dibayar',
};

/** Urutan filter di daftar klaim. */
export const CLAIM_FILTERS: readonly ClaimStatus[] = [
  'draft',
  'sent',
  'pending',
  'payable',
  'dispute',
  'paid',
];

export function levelTone(level: Claim['tag']['level']): ViewTone {
  return { ok: 'success', warn: 'warning', bad: 'danger', info: 'info', none: 'neutral' }[level] as ViewTone;
}

/** Label tombol kirim per status (mockup Klaim); null = berkas sudah di verifikator/selesai. */
export function submitLabel(status: ClaimStatus): string | null {
  if (status === 'draft') return 'Final dan kirim E-Klaim';
  if (status === 'pending') return 'Kirim tanggapan ke verifikator';
  if (status === 'dispute') return 'Ajukan penyelesaian dispute';
  return null;
}

/** Berkas yang belum lengkap (label). */
export function missingDocs(docs: ReadonlyArray<{ label: string; ok: boolean }>): string[] {
  return docs.filter((d) => !d.ok).map((d) => d.label);
}

/**
 * Tarif RS vs INA-CBG (bigint): persen tarif RS terhadap tarif INA-CBG dan lebar porsi INA-CBG pada batang
 * (100% bila INA-CBG ≥ tarif RS). Null bila salah satu belum ada.
 */
export function claimRatio(
  hospitalCost: string | null,
  tariff: string | null,
): { percent: number; cbgWidth: number; overrun: boolean; gap: bigint } | null {
  if (!hospitalCost || !tariff) return null;
  const rs = BigInt(hospitalCost);
  const cbg = BigInt(tariff);
  if (rs <= 0n || cbg <= 0n) return null;
  const percent = Number((rs * 100n + cbg / 2n) / cbg);
  const overrun = rs > cbg;
  const cbgWidth = overrun ? Number((cbg * 100n + rs / 2n) / rs) : 100;
  return { percent, cbgWidth, overrun, gap: rs - cbg };
}

export interface GrouperTileView {
  k: string;
  v: string;
  s: string;
  tone?: 'ok' | 'warn';
}

export interface CodingView {
  diagnoses: Claim['diagnoses'];
  grouper: Claim['grouper'];
  tiles: GrouperTileView[];
  /** Alasan grouping ditahan, null bila ada hasil grouper. */
  held: string | null;
}

/**
 * Tampilan koding setelah tindakan koder (mockup Klaim, kasus Ny. Endang): saran kode spesifik diterima → kode
 * utama diganti; bukti klinis diagnosis "perlu bukti" lengkap → menjadi sekunder; keduanya → grouper naik tingkat.
 */
export function codingView(
  claim: Claim,
  opts: { accepted: boolean; docs: ReadonlyArray<{ id: string; ok: boolean }> },
): CodingView {
  const sug = claim.suggestion;
  const evidence = !!sug && !!opts.docs.find((d) => d.id === sug.evidenceDocId)?.ok;
  const upgraded = !!sug && opts.accepted && evidence;
  const needsEvidence = claim.diagnoses.find((d) => d.role === 'perlu-bukti')?.code ?? 'bukti';
  const diagnoses = claim.diagnoses.map((d) =>
    sug && opts.accepted && d.code === sug.from
      ? { ...d, code: sug.to, name: sug.toName }
      : sug && evidence && d.role === 'perlu-bukti'
        ? { ...d, role: 'sekunder' as const }
        : d,
  );
  const base = claim.grouper;
  const grouper =
    base && sug && upgraded
      ? { ...base, cbg: sug.upgraded.cbg, name: sug.upgraded.name, tariff: sug.upgraded.tariff }
      : base;
  const rp = (v: string) => formatRupiah(BigInt(v));
  const cost: GrouperTileView = {
    k: 'Tarif RS',
    v: claim.hospitalCost ? rp(claim.hospitalCost) : '—',
    s: claim.hospitalCost ? 'billing final' : 'billing berjalan',
  };
  if (!grouper) {
    return {
      diagnoses,
      grouper,
      tiles: [{ k: 'Kode CBG', v: '—', s: 'dihitung setelah tindak lanjut' }, cost],
      held: !claim.encounter.discharged
        ? 'pasien masih dirawat; grouper dihitung setelah pulang dan resume final.'
        : claim.scenario === 'igd-ranap'
          ? 'kode utama tidak sesuai bukti klinis.'
          : 'resume medis belum final ber-TTE.',
    };
  }
  let third: GrouperTileView = cost;
  if (sug && base) {
    const up = sug.upgraded;
    third = upgraded
      ? {
          k: 'Sebelumnya',
          v: base.cbg,
          s: `${rp(base.tariff)} · naik ${formatRupiah(BigInt(up.tariff) - BigInt(base.tariff))}`,
          tone: 'ok',
        }
      : {
          k: opts.accepted
            ? `Jika ${needsEvidence} terbukti`
            : evidence
              ? `Jika ${sug.to} diterima`
              : `Jika ${sug.to} + ${needsEvidence}`,
          v: up.cbg,
          s: `${rp(up.tariff)} · ${opts.accepted ? 'lengkapi bukti CPPT' : evidence ? `tunggu konfirmasi ${sug.to}` : 'butuh bukti'}`,
          tone: 'warn',
        };
  }
  return {
    diagnoses,
    grouper,
    tiles: [
      {
        k: 'Kode CBG',
        v: grouper.cbg,
        s:
          sug && upgraded
            ? `${grouper.name} · ${sug.to} + ${needsEvidence}`
            : sug && opts.accepted
              ? `${grouper.name} · dx utama ${sug.to}`
              : grouper.name,
        tone: upgraded ? 'ok' : undefined,
      },
      {
        k: `Tarif ${grouper.classLabel}`,
        v: rp(grouper.tariff),
        s: `${grouper.final ? 'final' : 'estimasi'} · regional, RS kelas B`,
      },
      third,
      { k: 'Special CMG', v: grouper.specialCmg ?? 'tidak ada', s: '—' },
    ],
    held: null,
  };
}

/** Jumlah berkas lengkap, mis. "6/7 lengkap". */
export function docCount(docs: ReadonlyArray<{ ok: boolean }>): string {
  return `${docs.filter((d) => d.ok).length}/${docs.length} lengkap`;
}

/** Tindakan koder di layar untuk satu klaim (simulasi, tidak disimpan; mockup Klaim `queries`/`docs`/`sent`). */
export interface ClaimLocal {
  docs?: Claim['documents'];
  acceptedAt?: string | null;
  queryAt?: string | null;
  sentAt?: string | null;
  /** Jenis pengiriman: berkas awal ke E-Klaim, tanggapan pending, atau banding dispute. */
  sentKind?: 'kirim' | 'tanggapan' | 'banding';
}

/** Chip daftar klaim setelah tindakan koder (mockup Klaim `tagFor`). */
export function localClaimTag(claim: Pick<Claim, 'status' | 'tag'>, local: ClaimLocal): Claim['tag'] {
  if (claim.status === 'payable' || claim.status === 'paid') return claim.tag;
  if (local.sentAt) {
    return {
      label:
        local.sentKind === 'tanggapan' || claim.status === 'pending'
          ? 'Tanggapan terkirim'
          : local.sentKind === 'banding' || claim.status === 'dispute'
            ? 'Banding diajukan'
            : 'Terkirim',
      level: 'ok',
    };
  }
  if (local.acceptedAt) return { label: 'Saran diterima', level: 'ok' };
  if (local.queryAt) return { label: 'Menunggu DPJP', level: 'info' };
  return claim.tag;
}

/**
 * Status di kepala berkas klaim (mockup Klaim): berubah mengikuti query, saran yang diterima, kelengkapan berkas, dan
 * pengiriman, beserta nadanya (biru = menunggu pihak lain, hijau = terkirim).
 */
export function claimHeaderStatus(
  claim: Pick<Claim, 'status' | 'tag' | 'suggestion'>,
  local: ClaimLocal,
  view: { grouper: Claim['grouper']; missing: number },
): { label: string; tone: 'brand' | 'info' | 'success' } {
  if (claim.status === 'payable' || claim.status === 'paid') {
    return { label: `${CLAIM_STATUS_LABEL[claim.status]} · ${claim.tag.label}`, tone: 'success' };
  }
  if (local.sentAt) {
    return {
      label:
        claim.status === 'draft' || local.sentKind === 'kirim'
          ? 'Terkirim ke E-Klaim'
          : localClaimTag(claim, local).label,
      tone: 'success',
    };
  }
  const sug = claim.suggestion;
  if (sug && local.acceptedAt) {
    return view.missing === 0 && view.grouper
      ? { label: `Siap final · ${view.grouper.cbg}`, tone: 'brand' }
      : { label: `Siap grouping · ${sug.to}`, tone: 'brand' };
  }
  if (sug && local.queryAt) return { label: 'Menunggu jawaban DPJP', tone: 'info' };
  return { label: `${CLAIM_STATUS_LABEL[claim.status]} · ${claim.tag.label}`, tone: 'brand' };
}
