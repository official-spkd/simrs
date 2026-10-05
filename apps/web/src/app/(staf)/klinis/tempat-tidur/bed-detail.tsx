'use client';

import { type Bed, type BedStatus, formatJam, type Ward } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { BED_STATUS_META } from '@/lib/rawat-inap';

/** Transisi status bed lokal (mockup): label tombol, status baru, catatan. */
const NEXT: Partial<
  Record<BedStatus, { label: string; to: BedStatus; note: (t: string) => string; clear?: boolean }>
> = {
  dipesan: { label: 'Pasien tiba · tandai terisi', to: 'terisi', note: (t) => `H1 · masuk ${t}` },
  pulang: { label: 'Pasien sudah pulang', to: 'kotor', note: (t) => `kosong sejak ${t}`, clear: true },
  kotor: { label: 'Tandai dibersihkan', to: 'dibersihkan', note: (t) => `mulai dibersihkan ${t}` },
  dibersihkan: { label: 'Selesai dibersihkan · siap pakai', to: 'siap', note: (t) => `siap ${t}` },
  rusak: { label: 'Perbaikan selesai · siap pakai', to: 'siap', note: (t) => `diperbaiki ${t}` },
};

const HINT: Record<BedStatus, string> = {
  siap: 'Bed siap. Tekan "Alokasikan ke" pada permintaan di bawah.',
  terisi: 'Bed terisi. Buka rawat inap untuk CPPT dan eMAR pasien.',
  pulang: 'Pasien rencana pulang. Setelah pasien keluar, bed masuk antrean kebersihan.',
  dipesan: 'Bed dipesan. Tandai terisi saat pasien tiba di ruang.',
  kotor: 'Bed kotor. Tandai saat petugas kebersihan mulai bekerja.',
  dibersihkan: 'Sedang dibersihkan. Tandai siap setelah verifikasi kebersihan.',
  rusak: 'Bed tidak dapat dipakai sampai perbaikan selesai.',
};

export type BedPatch = Pick<Bed, 'status' | 'note'> & Partial<Pick<Bed, 'patientLabel' | 'encounterId'>>;

/** Kartu bed terpilih: rincian + satu aksi status berikutnya (atau alokasi pasien skenario). */
export function BedDetail({
  bed,
  ward,
  ranapHref,
  scenarioOwned,
  scenarioAlloc,
  onChange,
  onClose,
}: {
  bed: Bed;
  ward: Ward | undefined;
  ranapHref: string | null;
  scenarioOwned: boolean;
  scenarioAlloc: { label: string; enabled: boolean; run: () => void } | null;
  onChange: (code: string, patch: BedPatch, msg: string) => void;
  onClose: () => void;
}) {
  const m = BED_STATUS_META[bed.status];
  const next = scenarioOwned ? undefined : NEXT[bed.status];
  return (
    <section
      aria-label="Bed terpilih"
      className="flex flex-col gap-2.5 rounded-card border border-brand-200 bg-white px-4 py-3.5 shadow-[0_0_0_3px_rgba(15,118,110,0.08)]"
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
        {scenarioOwned ? 'Status bed pasien simulasi mengikuti alur admisi di Simulasi.' : HINT[bed.status]}
      </span>
      <div className="flex flex-wrap gap-2">
        {scenarioAlloc && (
          <Button variant="primary" size="sm" disabled={!scenarioAlloc.enabled} onClick={scenarioAlloc.run}>
            {scenarioAlloc.label}
          </Button>
        )}
        {next && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              const t = formatJam(new Date());
              onChange(
                bed.code,
                {
                  status: next.to,
                  note: next.note(t),
                  ...(next.clear ? { patientLabel: null, encounterId: null } : {}),
                },
                `${bed.code} · ${BED_STATUS_META[next.to].label.toLowerCase()} ${t} (simulasi, tidak disimpan)`,
              );
            }}
          >
            {next.label}
          </Button>
        )}
        {ranapHref && (
          <Link
            href={ranapHref}
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3.5 text-small font-semibold text-ink-900 no-underline"
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
