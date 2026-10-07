import type { ConsentDecision, ConsentDraft, ConsentRecord } from '@simrs/shared';
import { Chip, type ChipTone } from '@simrs/ui';

/** Label status draf tablet (selalu bertulisan, tidak hanya warna). */
export const DRAFT_STATUS: Record<ConsentDraft['status'], { label: string; tone: ChipTone }> = {
  draf: { label: 'Draf', tone: 'warning' },
  final: { label: 'Final', tone: 'success' },
  ditolak: { label: 'Ditolak pasien', tone: 'danger' },
  batal: { label: 'Draf dibatalkan', tone: 'neutral' },
};

/** Syarat final yang belum terpenuhi (`missing` dari API). */
export const MISSING_LABEL: Record<ConsentDraft['missing'][number], string> = {
  tanda_tangan: 'tanda tangan pasien/wali',
  saksi_petugas: 'atestasi saksi petugas',
  saksi_kedaluwarsa: 'atestasi saksi petugas kedaluwarsa (lebih dari 30 menit), ulangi atestasi',
};

export const DECISION: Record<ConsentDecision, { label: string; tone: ChipTone }> = {
  setuju: { label: 'Disetujui', tone: 'success' },
  tolak: { label: 'Ditolak pasien', tone: 'danger' },
  dicabut: { label: 'Dicabut', tone: 'neutral' },
};

export const TTE_LABEL: Record<'pending' | 'signed' | 'failed', { label: string; tone: ChipTone }> = {
  pending: { label: 'TTE diproses', tone: 'info' },
  signed: { label: 'TTE sah', tone: 'success' },
  failed: { label: 'TTE gagal', tone: 'danger' },
};

export function DraftStatusChip({ draft }: { draft: ConsentDraft }) {
  if (draft.status === 'draf') {
    return (
      <Chip tone="warning">
        {draft.missing.length === 0
          ? 'Siap TTE dokter'
          : `Draf · menunggu ${MISSING_LABEL[draft.missing[0]!]}`}
      </Chip>
    );
  }
  const s = DRAFT_STATUS[draft.status];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export function TteChip({ consent }: { consent: ConsentRecord }) {
  const status = consent.document?.signatureStatus;
  if (!status) return null;
  const s = TTE_LABEL[status];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}
