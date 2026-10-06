import {
  type CpptEntry,
  type CpptRole,
  findForbiddenAbbreviations,
  formatJam,
  SAMPLE_FORBIDDEN_ABBREVIATIONS,
} from '@simrs/shared';
import { type SoapText, supersededIds } from './rawat-inap';

/**
 * K07 · CPPT terintegrasi lintas PPA, co-sign residen, verifikasi DPJP, dan serah terima SBAR antarshift. Entri
 * final immutable (koreksi = versi baru beralasan, PPA lain = addendum; fungsi di `rawat-inap.ts`). Di sini: status
 * tampilan, gerbang co-sign/verifikasi, riwayat versi, singkatan terlarang, dan alur serah terima.
 */

/** Verifikasi DPJP atas CPPT PPA lain (perawat, bidan, farmasi, gizi) dalam 24 jam (keputusan fase 3 no. 5). */
export const VERIFY_WITHIN_HOURS = 24;

export interface CpptSign {
  by: string;
  at: string;
}

/** Entri yang butuh verifikasi DPJP: PPA non-dokter. Catatan residen memakai co-sign, catatan DPJP tidak perlu. */
export function needsVerification(e: Pick<CpptEntry, 'role'>): boolean {
  return e.role !== 'dpjp' && e.role !== 'residen';
}

export function verifyDeadline(e: Pick<CpptEntry, 'writtenAt'>): string {
  return new Date(Date.parse(e.writtenAt) + VERIFY_WITHIN_HOURS * 3_600_000).toISOString();
}

export type CpptStatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export interface CpptStatus {
  label: string;
  tone: CpptStatusTone;
}

/** Status bertulisan satu entri (bukan hanya warna). */
export function cpptStatus(
  e: CpptEntry,
  o: { superseded: boolean; cosign: CpptSign | null; verified: CpptSign | null; nowIso: string },
): CpptStatus {
  if (o.superseded) return { label: 'Versi lama · digantikan koreksi (tetap tersimpan)', tone: 'neutral' };
  if (e.cosignRequired) {
    const c = o.cosign ?? (e.cosignedBy && e.cosignedAt ? { by: e.cosignedBy, at: e.cosignedAt } : null);
    return c
      ? { label: `Final · co-sign DPJP ${c.by} · ${formatJam(c.at)}`, tone: 'success' }
      : { label: 'Belum final · menunggu co-sign DPJP', tone: 'warning' };
  }
  if (!needsVerification(e))
    return { label: `Final · ditandatangani ${formatJam(e.writtenAt)}`, tone: 'success' };
  if (o.verified) {
    return {
      label: `Final · diverifikasi DPJP ${o.verified.by} · ${formatJam(o.verified.at)}`,
      tone: 'success',
    };
  }
  const late = Date.parse(verifyDeadline(e)) < Date.parse(o.nowIso);
  return late
    ? { label: `Final · verifikasi DPJP lewat ${VERIFY_WITHIN_HOURS} jam`, tone: 'danger' }
    : { label: `Final · menunggu verifikasi DPJP (batas ${formatJam(verifyDeadline(e))})`, tone: 'info' };
}

/** Gerbang co-sign: hanya catatan residen yang belum di-co-sign, oleh DPJP (posisi dokter), bukan catatan sendiri. */
export function cosignBlocker(
  e: CpptEntry,
  o: { role: string | null; user: string; superseded: boolean; cosigned: boolean },
): string | null {
  if (!e.cosignRequired) return 'Bukan catatan residen.';
  if (o.superseded) return 'Versi lama; co-sign versi terbaru.';
  if (o.cosigned || e.cosignedBy) return 'Sudah di-co-sign DPJP.';
  if (o.role !== 'dokter') return 'Hanya DPJP (posisi dokter) yang dapat co-sign.';
  if (e.author === o.user) return 'Tidak bisa co-sign catatan sendiri.';
  return null;
}

/** Gerbang verifikasi DPJP atas CPPT PPA lain. */
export function verifyBlocker(
  e: CpptEntry,
  o: { role: string | null; user: string; superseded: boolean; verified: boolean },
): string | null {
  if (!needsVerification(e)) return 'Catatan dokter tidak perlu verifikasi.';
  if (o.superseded) return 'Versi lama; verifikasi versi terbaru.';
  if (o.verified) return 'Sudah diverifikasi DPJP.';
  if (o.role !== 'dokter') return 'Hanya DPJP (posisi dokter) yang memverifikasi CPPT PPA lain.';
  return null;
}

/** Label tombol simpan catatan baru: residen tidak bisa memfinalkan sendiri. */
export function submitLabel(role: CpptRole): string {
  return role === 'residen' ? 'Simpan dan ajukan co-sign DPJP' : 'Simpan dan tanda tangani (final)';
}

/** Penjelasan gerbang residen yang selalu tampil di formulir residen. */
export const RESIDENT_GATE =
  'Catatan residen tersimpan berstatus "belum final" dan baru final setelah DPJP co-sign. Residen tidak dapat memfinalkan catatannya sendiri.';

/** Rantai versi entri (versi 1 → terbaru) yang memuat `id`. */
export function versionChain(entries: readonly CpptEntry[], id: string): CpptEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let root = byId.get(id);
  while (root?.supersedesId && byId.has(root.supersedesId)) root = byId.get(root.supersedesId);
  if (!root) return [];
  const chain = [root];
  for (;;) {
    const last = chain[chain.length - 1];
    const next = entries.find((e) => e.supersedesId === last?.id);
    if (!next) break;
    chain.push(next);
  }
  return chain;
}

/** Entri yang tampil di linimasa: versi terbaru setiap rantai (versi lama dibuka lewat "Riwayat versi"). */
export function latestEntries(entries: readonly CpptEntry[]): CpptEntry[] {
  const old = supersededIds(entries);
  return entries.filter((e) => !old.has(e.id));
}

/** Singkatan terlarang di SOAP (peringatan, tidak memblokir; EP 9a). */
export function soapAbbreviations(
  soap: SoapText,
): Array<{ field: keyof SoapText; found: string; suggestion: string }> {
  return (['s', 'o', 'a', 'p'] as const).flatMap((field) =>
    findForbiddenAbbreviations(soap[field], SAMPLE_FORBIDDEN_ABBREVIATIONS).map((m) => ({
      field,
      found: m.found,
      suggestion: m.suggestion,
    })),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Serah terima SBAR antarshift
// ---------------------------------------------------------------------------------------------------------

export interface Sbar {
  s: string;
  b: string;
  a: string;
  r: string;
}

export interface Handover {
  id: string;
  shift: string;
  giver: string;
  receiver: string;
  sbar: Sbar;
  givenAt: string;
  /** Null = belum dikonfirmasi penerima. */
  acceptedAt: string | null;
}

/** Siap diserahkan: keempat bagian SBAR terisi dan penerima dipilih (bukan pemberi sendiri). */
export function handoverBlocker(sbar: Sbar, receiver: string, giver: string): string | null {
  const empty = (['s', 'b', 'a', 'r'] as const).filter((k) => !sbar[k].trim());
  if (empty.length > 0) return `Lengkapi bagian ${empty.map((k) => k.toUpperCase()).join(', ')} SBAR.`;
  if (!receiver) return 'Pilih perawat penerima shift berikutnya.';
  if (receiver === giver) return 'Penerima harus petugas shift berikutnya, bukan pemberi.';
  return null;
}

export function handoverStatus(h: Pick<Handover, 'acceptedAt' | 'receiver'>): string {
  return h.acceptedAt
    ? `Diterima ${h.receiver} · ${formatJam(h.acceptedAt)}`
    : `Menunggu konfirmasi ${h.receiver}`;
}
