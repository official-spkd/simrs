'use client';

import type { Bed, BedStatus, Ward } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { BED_NEXT } from '@/lib/rawat-inap-bed-toko';
import { BED_STATUS_META } from '@/lib/rawat-inap';

const HINT: Record<BedStatus, (b: Bed) => string> = {
  siap: (b) => `Bed siap. Tekan "Alokasikan ke ${b.code}" pada permintaan di bawah.`,
  terisi: () => 'Bed terisi. Buka rawat inap untuk CPPT dan eMAR pasien.',
  pulang: () =>
    'Pasien rencana pulang. Setelah resume final dan pasien keluar, bed masuk antrean kebersihan.',
  dipesan: (b) =>
    b.patientLabel
      ? `Dipesan untuk ${b.patientLabel}. Tandai terisi saat pasien tiba di bangsal.`
      : 'Bed dipesan. Tandai terisi saat pasien tiba di bangsal.',
  kotor: () => 'Bed kotor. Tandai saat petugas kebersihan mulai bekerja.',
  dibersihkan: () => 'Sedang dibersihkan. Tandai siap setelah verifikasi kebersihan.',
  rusak: () => 'Bed tidak dapat dipakai sampai perbaikan selesai.',
};

/**
 * Kartu bed terpilih: rincian + satu aksi status berikutnya (atau alokasi pasien skenario). Status baru diperiksa dan
 * disimpan server (toko demo `tempat-tidur`).
 */
export function BedDetail({
  bed,
  ward,
  ranapHref,
  scenarioOwned,
  scenarioAlloc,
  busy,
  onAdvance,
  onClose,
}: {
  bed: Bed;
  ward: Ward | undefined;
  ranapHref: string | null;
  scenarioOwned: boolean;
  scenarioAlloc: { label: string; enabled: boolean; run: () => void } | null;
  busy: boolean;
  onAdvance: (code: string) => void;
  onClose: () => void;
}) {
  const m = BED_STATUS_META[bed.status];
  const next = scenarioOwned ? undefined : BED_NEXT[bed.status];
  return (
    <section
      aria-label="Bed terpilih"
      className="flex flex-col gap-2.5 rounded-card border border-brand-200 bg-white/90 px-4 py-3.5 shadow-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-caption text-ink-500">Bed terpilih</span>
          <span className="font-mono text-h2 font-bold">{bed.code}</span>
        </span>
        <span className={cx('rounded-full border px-2.5 py-1 text-caption font-bold', m.tile, m.text)}>
          {m.label}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
        <dt className="text-ink-500">Bangsal</dt>
        <dd className="m-0">
          {ward?.name ?? bed.wardCode} · {ward?.service}
        </dd>
        <dt className="text-ink-500">Kelas</dt>
        <dd className="m-0">{ward?.kelas}</dd>
        <dt className="text-ink-500">Pasien</dt>
        <dd className="m-0 font-semibold">{bed.patientLabel ?? '—'}</dd>
        <dt className="text-ink-500">Catatan</dt>
        <dd className="m-0">{bed.note || '—'}</dd>
      </dl>
      <span className="text-[12.5px] text-ink-700">
        {scenarioOwned
          ? 'Status bed pasien simulasi mengikuti alur admisi di Simulasi.'
          : HINT[bed.status](bed)}
      </span>
      <div className="flex flex-wrap gap-2">
        {scenarioAlloc && (
          <Button variant="primary" size="sm" disabled={!scenarioAlloc.enabled} onClick={scenarioAlloc.run}>
            {scenarioAlloc.label}
          </Button>
        )}
        {next && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onAdvance(bed.code)}>
            {next.label}
          </Button>
        )}
        {ranapHref && (
          <Link
            href={ranapHref}
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
          >
            Buka rawat inap
          </Link>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      </div>
    </section>
  );
}
