'use client';

import { type ComponentCode, COMPONENTS, formatJam } from '@simrs/shared';
import { Button, Chip, cx, FilterChip } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canToggle,
  isCoreModule,
  LAYER_LABEL,
  MODULE_CODES,
  type ModuleState,
  moduleDiff,
} from '@/lib/platform-pengaturan';
import { ActivityLog, type ConfirmRequest, ConfirmDialog, Panel, Stamp } from './parts';

const LAYERS = Object.keys(LAYER_LABEL);

/**
 * P10 · Modul aktif per RS (`tenant_modules`): sakelar per modul dengan gerbang dependensi (modul inti tidak bisa
 * dimatikan, modul yang dipakai modul aktif lain tidak bisa dimatikan, modul tidak bisa dinyalakan sebelum
 * dependensinya aktif). Perubahan dikumpulkan sebagai draf lalu disimpan sekaligus berkonfirmasi + alasan ke toko
 * demo bersama (domain `pengaturan`); modul yang mati dibaca layar lain (menu) lewat `readActiveModules`.
 */
export function PengaturanModul({
  saved,
  log,
  rev,
}: {
  saved: ModuleState;
  log: ReadonlyArray<{ t: string; text: string }>;
  rev: number;
}) {
  const [draft, setDraft] = useState(saved);
  const [layer, setLayer] = useState<string>('penunjang');
  const [confirming, setConfirming] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const { dispatch, pending, error } = useDemoDispatch('pengaturan', rev);

  const diff = moduleDiff(saved, draft);
  const shown = MODULE_CODES.filter((c) => layer === 'semua' || COMPONENTS[c].layer === layer);
  const activeCount = MODULE_CODES.filter((c) => draft[c]).length;
  const label = (c: ComponentCode) => `${c} ${COMPONENTS[c].name}`;

  const request: ConfirmRequest | null = confirming
    ? {
        title: `Simpan ${diff.length} perubahan modul?`,
        body: (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {diff.map((d) => (
              <li key={d.code}>
                {d.on ? 'Aktifkan' : 'Matikan'} <b>{label(d.code)}</b>
              </li>
            ))}
            <li className="pt-1 text-ink-500">
              Berlaku untuk RS ini tanpa rilis ulang; menu dan endpoint modul yang dimatikan tertutup untuk
              semua pengguna.
            </li>
          </ul>
        ),
        confirmLabel: 'Ya, simpan',
        reasonLabel: 'Alasan perubahan',
        reasonPlaceholder: 'mis. Instalasi Gizi mulai memakai SIM RS 12 Okt',
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="group" aria-label="Saring lapisan" className="flex flex-wrap gap-2">
          <FilterChip selected={layer === 'semua'} onClick={() => setLayer('semua')}>
            Semua
          </FilterChip>
          {LAYERS.map((l) => (
            <FilterChip key={l} selected={layer === l} onClick={() => setLayer(l)}>
              {LAYER_LABEL[l]}
            </FilterChip>
          ))}
        </span>
        <span className="text-small text-ink-700">
          {activeCount} aktif · {MODULE_CODES.length - activeCount} mati dari {MODULE_CODES.length} modul
        </span>
      </div>

      <div
        role="region"
        aria-label="Perubahan belum disimpan"
        className={cx(
          'flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2',
          diff.length > 0 ? 'border-[#F5D9A8] bg-warning-bg' : 'border-line bg-white',
        )}
      >
        <span className="text-small">
          {diff.length === 0
            ? 'Tidak ada perubahan yang belum disimpan.'
            : `${diff.length} perubahan belum disimpan: ${diff
                .map((d) => `${d.code} → ${d.on ? 'aktif' : 'mati'}`)
                .join(', ')}`}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" disabled={diff.length === 0 || pending} onClick={() => setDraft(saved)}>
            Batalkan draf
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={diff.length === 0 || pending}
            onClick={() => setConfirming(true)}
          >
            Simpan perubahan
          </Button>
        </span>
        {(flash || error) && (
          <span role="status" className="basis-full">
            <Stamp>{error ?? flash}</Stamp>
          </span>
        )}
      </div>

      <ul
        aria-label="Daftar modul"
        className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2 p-0"
      >
        {shown.map((c) => {
          const on = draft[c];
          const check = canToggle(c, draft);
          const changed = saved[c] !== draft[c];
          const reasonId = `modul-${c}-alasan`;
          return (
            <li
              key={c}
              className={cx(
                'flex flex-col gap-1 rounded-control border bg-white px-3 py-2',
                changed ? 'border-warning' : 'border-line',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="text-small font-semibold">
                    <span className="font-mono text-brand-700">{c}</span> {COMPONENTS[c].name}
                  </span>
                  <span className="text-caption text-ink-500">
                    {LAYER_LABEL[COMPONENTS[c].layer]} · {COMPONENTS[c].stage}
                    {isCoreModule(c) ? ' · inti' : ''}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label(c)}
                  aria-describedby={!check.ok ? reasonId : undefined}
                  disabled={!check.ok}
                  onClick={() => setDraft((cur) => ({ ...cur, [c]: !cur[c] }))}
                  className={cx(
                    'inline-flex h-11 min-w-[88px] flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 font-[inherit] text-small font-semibold',
                    on
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line-strong bg-white text-ink-700',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  {on ? 'Aktif' : 'Mati'}
                </button>
              </div>
              {changed && <Chip tone="warning">Draf: akan {on ? 'diaktifkan' : 'dimatikan'}</Chip>}
              {!check.ok && (
                <span id={reasonId} className="text-caption text-ink-500">
                  {check.reason}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <Panel title="Riwayat modul" sub="Hari ini · tercatat di jejak audit">
        <ActivityLog label="Riwayat perubahan modul" items={[...log]} />
      </Panel>

      <ConfirmDialog
        request={request}
        onClose={() => setConfirming(false)}
        onConfirm={(reason) => {
          const t = formatJam(demoNow());
          const n = diff.length;
          dispatch({ type: 'modul.disimpan', changes: diff, reason, jam: t }, (ok) => {
            if (ok) setFlash(`Tersimpan · ${t} · ${n} modul berubah, berlaku tanpa rilis ulang`);
          });
        }}
      />
    </div>
  );
}
