import { formatTanggal } from '@simrs/shared';
import { type License, licenseStatus, worstLicense } from './sdm';

/**
 * B04 · Kredensial dan kewenangan klinis (rencana fase 8 §8.3): pengajuan kewenangan → verifikasi berkas →
 * telaah mitra bestari → rekomendasi komite medik → RKK/SPK terbit (berlaku 3 tahun) → ditegakkan di CPOE
 * (`PRIVILEGE_REQUIRED`). Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

export const CRED_STAGES = [
  'Diajukan',
  'Verifikasi berkas',
  'Telaah mitra bestari',
  'Rekomendasi komite',
  'RKK terbit',
] as const;

export const RKK_YEARS = 3;

export type PrivilegeDecision = 'diberikan' | 'supervisi' | 'tidak';

export const DECISION_LABEL: Record<PrivilegeDecision, string> = {
  diberikan: 'Diberikan (mandiri)',
  supervisi: 'Diberikan dengan supervisi',
  tidak: 'Tidak diberikan',
};

/** Verifikasi berkas: izin praktik harus berlaku dan portofolio lengkap. */
export function credentialVerifyBlock(
  licenses: readonly License[],
  today: string,
  documents: ReadonlyArray<{ label: string; ok: boolean }>,
): string | null {
  const w = worstLicense(licenses, today);
  if (w.status === 'kedaluwarsa') {
    return `${w.license?.kind ?? 'Izin'} kedaluwarsa: perbarui dulu di SDM sebelum kredensial diproses.`;
  }
  const missing = documents.filter((d) => !d.ok).map((d) => d.label);
  if (missing.length > 0) return `Berkas belum lengkap: ${missing.join(', ')}.`;
  return null;
}

/** Telaah: setiap butir diputuskan dan catatan mitra bestari minimal 10 huruf. */
export function reviewBlock(
  items: readonly string[],
  decisions: Readonly<Record<string, PrivilegeDecision | undefined>>,
  note: string,
): string | null {
  const open = items.filter((i) => !decisions[i]).length;
  if (open > 0) return `${open} butir kewenangan belum diputuskan.`;
  if (note.trim().length < 10) return 'Tulis catatan mitra bestari minimal 10 huruf.';
  return null;
}

export function rkkExpiry(issued: string, years = RKK_YEARS): string {
  const [y = 2026, m = 1, d = 1] = issued.slice(0, 10).split('-').map(Number);
  return `${String(y + years).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function rkkNumber(seq: number, period = '2026/10'): string {
  return `RKK/${period}/${String(seq).padStart(3, '0')}`;
}

export interface GrantedPrivilege {
  practitioner: string;
  item: string;
  decision: Exclude<PrivilegeDecision, 'tidak'>;
  /** `YYYY-MM-DD` akhir RKK. */
  expiry: string;
}

export type OrderGuardResult =
  | { ok: true; text: string }
  | { ok: false; code: 'PRIVILEGE_REQUIRED' | 'PRIVILEGE_EXPIRED' | 'LICENSE_EXPIRED'; text: string };

/** Kait CPOE: tindakan hanya boleh dipesan praktisi yang punya kewenangan berlaku dan SIP berlaku. */
export function orderGuard(
  practitioner: string,
  item: string,
  privileges: readonly GrantedPrivilege[],
  licenses: readonly License[],
  today: string,
): OrderGuardResult {
  const w = worstLicense(licenses, today);
  if (w.status === 'kedaluwarsa') {
    return {
      ok: false,
      code: 'LICENSE_EXPIRED',
      text: `${w.license?.kind ?? 'Izin'} ${practitioner} kedaluwarsa.`,
    };
  }
  const p = privileges.find((x) => x.practitioner === practitioner && x.item === item);
  if (!p)
    return {
      ok: false,
      code: 'PRIVILEGE_REQUIRED',
      text: `${practitioner} belum punya kewenangan "${item}".`,
    };
  if (licenseStatus(p.expiry, today).status === 'kedaluwarsa') {
    return {
      ok: false,
      code: 'PRIVILEGE_EXPIRED',
      text: `Kewenangan "${item}" ${practitioner} sudah berakhir.`,
    };
  }
  return {
    ok: true,
    text:
      p.decision === 'supervisi'
        ? `Diizinkan dengan supervisi: order masuk antrean co-sign supervisor.`
        : `Diizinkan: kewenangan mandiri berlaku s.d. ${formatTanggal(p.expiry)}.`,
  };
}
