'use client';

import type { PharmacyPrescription } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useState } from 'react';
import {
  HANDOVER_CHECKS,
  prepChecklist,
  requiresDoubleCheck,
  type RxLocal,
  workBlock,
} from '@/lib/penunjang-farmasi';
import { DoubleCheck } from './farmasi-double-check';

export type Receiver = 'pasien' | 'keluarga' | 'perawat';

/**
 * Penyiapan dan serah terima (mockup Farmasi): centang tiap obat/langkah; obat high alert wajib cek ganda apoteker
 * kedua; serah terima memilih penerima. Tombol selesai nonaktif dengan alasan tertulis sampai syarat lengkap.
 */
export function FarmasiWork({
  tab,
  rx,
  local,
  pharmacists,
  currentUser,
  busy,
  serverError,
  scenarioReason,
  scenarioReceivers,
  onToggle,
  onDoubleCheck,
  onDone,
}: {
  tab: 'siap' | 'serah';
  rx: PharmacyPrescription;
  local: RxLocal | undefined;
  pharmacists: readonly string[];
  currentUser: string;
  busy: boolean;
  serverError: string | null;
  /** Alasan tugas simulasi belum giliran (resep pasien skenario), atau null. */
  scenarioReason: string | null;
  /** Resep pasien skenario: hanya pilihan penerima naskah simulasi. */
  scenarioReceivers: boolean;
  onToggle: (kind: 'prep' | 'handover', index: number) => void;
  onDoubleCheck: (second: string) => void;
  onDone: (receiver: Receiver | null) => void;
}) {
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  const prep = tab === 'siap';
  const list = prep ? prepChecklist(rx) : [...HANDOVER_CHECKS];
  const checks = (prep ? local?.prep : local?.handover) ?? {};
  const checked = list.filter((_, i) => checks[i]).length;
  const dc = prep && requiresDoubleCheck(rx);
  const receivers: Array<{ id: Receiver; label: string }> = [
    { id: 'pasien', label: 'Pasien sendiri' },
    { id: 'keluarga', label: 'Keluarga' },
    ...(!scenarioReceivers && rx.setting !== 'rawat-jalan'
      ? [{ id: 'perawat' as const, label: 'Perawat ruangan' }]
      : []),
  ];
  const reason =
    workBlock({
      total: list.length,
      checked,
      doubleCheckRequired: dc,
      doubleCheckDone: !!local?.doubleCheck,
    }) ??
    (!prep && !receiver ? 'Pilih penerima obat.' : null) ??
    scenarioReason;

  return (
    <section
      aria-label={prep ? 'Penyiapan obat' : 'Serah terima obat'}
      className="flex flex-col gap-2.5 rounded-card border border-line bg-white px-4 py-3.5"
    >
      <h3 className="m-0 text-body font-semibold">{prep ? 'Penyiapan obat' : 'Serah terima obat'}</h3>
      <p className="m-0 text-small text-ink-700">
        {prep
          ? 'Centang setiap obat setelah diambil, dihitung, dan diberi etiket. Obat high alert wajib cek ganda.'
          : 'Serahkan ke pasien, keluarga, atau perawat ruangan dengan verifikasi identitas. Stok depo berkurang saat diserahkan.'}
      </p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {list.map((t, i) => (
          <li key={t}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                checked={!!checks[i]}
                onChange={() => onToggle(prep ? 'prep' : 'handover', i)}
                className="size-[18px] flex-none accent-brand-600"
              />
              <span className={cx(checks[i] ? 'text-ink-500' : 'text-ink-900')}>{t}</span>
            </label>
          </li>
        ))}
      </ul>
      {dc && (
        <DoubleCheck
          items={rx.items
            .filter((i) => i.highAlert)
            .map((i) => `${i.name} · ${i.dose} ${i.route} · ${i.frequency}`)}
          pharmacists={pharmacists}
          currentUser={currentUser}
          done={local?.doubleCheck ?? null}
          busy={busy}
          serverError={serverError}
          onConfirm={onDoubleCheck}
        />
      )}
      {!prep && (
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="mb-1.5 text-small font-semibold">Diterima oleh</legend>
          {receivers.map((r) => (
            <label
              key={r.id}
              className={cx(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-small',
                receiver === r.id
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line-strong bg-white',
              )}
            >
              <input
                type="radio"
                name={`penerima-${rx.id}`}
                checked={receiver === r.id}
                onChange={() => setReceiver(r.id)}
                className="size-4 accent-brand-600"
              />
              {r.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {reason && (
          <span id={`kerja-alasan-${rx.id}`} className="text-[12.5px] font-semibold text-warning">
            {reason}
          </span>
        )}
        <Button
          variant="primary"
          disabled={busy || !!reason}
          aria-describedby={reason ? `kerja-alasan-${rx.id}` : undefined}
          onClick={() => onDone(receiver)}
        >
          {prep ? 'Selesai disiapkan' : 'Serahkan obat'}
        </Button>
      </div>
    </section>
  );
}
