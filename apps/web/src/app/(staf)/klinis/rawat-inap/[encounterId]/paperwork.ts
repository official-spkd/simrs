import { formatJam } from '@simrs/shared';
import type { ConsentStatus, DischargeStatus } from '@/lib/server/data/klinis/ranap-api';

/**
 * Teks status resume medis (3.6) dan persetujuan tindakan (3.7) di layar Rawat inap mode api. Modul biasa (dipakai
 * halaman server dan tab klien). Status selalu bertulisan, tidak hanya warna.
 */

const TTE = { pending: 'TTE diproses', signed: 'TTE ditandatangani', failed: 'TTE gagal' } as const;

export function dischargeLabel(d: DischargeStatus | null): string | null {
  if (!d) return null;
  if (d.state === 'belum') return 'belum dibuat';
  if (d.state === 'draf') return 'draf';
  const tte = d.final?.document?.signatureStatus;
  return `final ${d.final ? formatJam(d.final.recordedAt) : ''}${tte ? ` · ${TTE[tte]}` : ''}`.replace(
    / +·/,
    ' ·',
  );
}

const DECISION = { setuju: 'setuju', tolak: 'menolak', dicabut: 'dicabut' } as const;

export function consentLabel(list: ConsentStatus[] | null): string | null {
  if (!list) return null;
  if (list.length === 0) return 'belum ada';
  return list.map((c) => `${c.procedure} (${DECISION[c.effectiveDecision]})`).join(' · ');
}
