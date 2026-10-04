'use client';

import { Button, cx, SafetyGate } from '@simrs/ui';
import { useState } from 'react';

export interface EmarScan {
  /** Gelang cocok atau override beralasan; selain itu grid terkunci. */
  status: 'terkunci' | 'cocok' | 'override';
  at: string | null;
  reason: string | null;
}

/**
 * Gerbang pindai gelang eMAR (CLAUDE.md §4.9): pemberian obat terkunci sampai gelang cocok (diperiksa server).
 * Gelang tak terbaca → gerbang keselamatan: pindai ulang, atau lanjut dengan verifikasi manual dua identitas + alasan
 * tertulis. Pasien skenario di luar gilirannya: tombol tetap terlihat, nonaktif, dengan alasannya.
 */
export function EmarGate({
  scan,
  rm,
  name,
  note,
  wait,
  progress,
  busy,
  onScan,
  onOverride,
}: {
  scan: EmarScan;
  rm: string;
  name: string;
  note: string;
  /** Alasan menunggu giliran Simulasi (pasien skenario), null = boleh pindai. */
  wait: string | null;
  /** Kemajuan dosis jam "kini" yang tampil setelah gelang cocok. */
  progress: string | null;
  busy: boolean;
  onScan: () => void;
  onOverride: (reason: string) => void;
}) {
  const [unreadable, setUnreadable] = useState(false);
  if (scan.status !== 'terkunci') {
    return (
      <div
        role="status"
        className={cx(
          'flex flex-col gap-0.5 rounded-control border px-3.5 py-2.5 text-small',
          scan.status === 'cocok'
            ? 'border-success-border bg-success-bg text-success'
            : 'border-warning-border bg-warning-bg text-warning',
        )}
      >
        <span className="font-semibold">
          {scan.status === 'cocok'
            ? `✓ Pasien benar · gelang terpindai${scan.at ? ` ${scan.at}` : ''} · RM ${rm}`
            : `Override tercatat ${scan.at ?? ''} · verifikasi manual dua identitas`}
        </span>
        {scan.reason && <span className="text-ink-700">Alasan: {scan.reason}</span>}
        <span className="text-ink-700">
          Pilih satu slot jadwal, pindai label obatnya, lalu catat pemberian dosis itu.
          {progress ? ` ${progress}` : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-control border border-warning-border bg-[linear-gradient(100deg,rgba(138,75,0,0.08),#FFFAF2_60%)] px-3.5 py-3"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold text-warning-strong">
            Pemberian obat terkunci sampai gelang pasien cocok
          </span>
          <span className="text-small text-ink-700">{note}</span>
          {wait && (
            <span id="emar-tunggu" className="text-small font-semibold text-ink-700">
              {wait} Gelang dipindai pada langkah perawatan pasien ini.
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy || !!wait}
            aria-describedby={wait ? 'emar-tunggu' : undefined}
            onClick={onScan}
          >
            Pindai gelang
          </Button>
          {!unreadable && (
            <Button disabled={busy || !!wait} onClick={() => setUnreadable(true)}>
              Gelang tidak terbaca
            </Button>
          )}
        </span>
      </div>
      {unreadable && !wait && (
        <SafetyGate
          title="Gelang tidak terbaca: identitas belum terverifikasi"
          recommendation="Pindai ulang gelang"
          overrideLabel="Verifikasi manual dua identitas"
          onFollow={() => {
            setUnreadable(false);
            onScan();
          }}
          onOverride={onOverride}
          disabled={busy}
        >
          Cocokkan nama ({name}) dan tanggal lahir/RM ({rm}) dengan pasien, lalu tulis alasan. Override
          tercatat dan ditinjau komite keselamatan pasien.
        </SafetyGate>
      )}
    </div>
  );
}
