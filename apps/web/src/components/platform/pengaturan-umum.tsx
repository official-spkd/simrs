'use client';

import { formatJam, TENANT_SETTINGS, type TenantSettingKey } from '@simrs/shared';
import { Button, Field } from '@simrs/ui';
import { useState } from 'react';
import { useDemoDispatch } from '@/lib/demo/store/client';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  changedSettings,
  coerceSetting,
  SETTING_GROUPS,
  type SettingDraft,
  validateSettings,
} from '@/lib/platform-pengaturan';
import { Panel, Stamp } from './parts';

type Hours = { open: string; close: string };

/**
 * P10 · Pengaturan umum RS dari registri `TENANT_SETTINGS` (skema yang sama dengan API): angka divalidasi batas
 * min/maks skemanya, jam layanan buka < tutup. Simpan nonaktif beralasan bila tidak ada perubahan atau ada galat.
 * Tersimpan di toko demo bersama (domain `pengaturan`) dan dibaca layar lain (mis. rata-rata layanan di info publik).
 */
export function PengaturanUmum({
  saved,
  lastSaved,
  rev,
}: {
  saved: SettingDraft;
  lastSaved: { jam: string; by: string; keys: TenantSettingKey[] } | null;
  rev: number;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])),
  );
  const [flash, setFlash] = useState<string | null>(null);
  const { dispatch, pending, error } = useDemoDispatch('pengaturan', rev);

  const errors = validateSettings(draft as SettingDraft);
  const changed = changedSettings(saved, draft as SettingDraft);
  const hasErrors = Object.keys(errors).length > 0;
  const reason = hasErrors
    ? 'Perbaiki isian yang ditandai merah dulu.'
    : changed.length === 0
      ? 'Belum ada nilai yang diubah.'
      : null;

  const set = (key: TenantSettingKey, value: unknown) => {
    setFlash(null);
    setDraft((cur) => ({ ...cur, [key]: value }));
  };

  const save = () => {
    if (reason || pending) return;
    const values: Record<string, unknown> = {};
    for (const k of changed) values[k] = coerceSetting(k, draft[k]);
    const t = formatJam(demoNow());
    const text = `Tersimpan · ${t} · ${changed.length} pengaturan berubah (${changed
      .map((k) => TENANT_SETTINGS[k].label.toLowerCase())
      .join('; ')})`;
    dispatch({ type: 'pengaturan.disimpan', values, jam: t }, (ok) => ok && setFlash(text));
  };

  return (
    <form
      aria-label="Pengaturan umum"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        {SETTING_GROUPS.map((g) => (
          <Panel key={g.title} title={g.title}>
            {g.keys.map((key) => {
              const def = TENANT_SETTINGS[key];
              if (key === 'service.hours') {
                const v = draft[key] as Hours;
                return (
                  <fieldset key={key} className="m-0 flex flex-col gap-1.5 border-0 p-0">
                    <legend className="mb-1.5 p-0 text-small font-semibold text-ink-700">{def.label}</legend>
                    <div className="flex flex-wrap gap-2">
                      <Field
                        label="Buka"
                        type="time"
                        className="flex-[1_1_110px]"
                        value={v.open}
                        onChange={(e) => set(key, { ...v, open: e.target.value })}
                      />
                      <Field
                        label="Tutup"
                        type="time"
                        className="flex-[1_1_110px]"
                        value={v.close}
                        onChange={(e) => set(key, { ...v, close: e.target.value })}
                        error={errors[key] ?? null}
                      />
                    </div>
                  </fieldset>
                );
              }
              return (
                <Field
                  key={key}
                  label={def.label}
                  inputMode="numeric"
                  value={String(draft[key] ?? '')}
                  onChange={(e) => set(key, e.target.value)}
                  error={errors[key] ?? null}
                  hint={`Bawaan ${String(def.default)}`}
                  hintTone="muted"
                />
              );
            })}
          </Panel>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={!!reason || pending}
          aria-describedby={reason ? 'umum-alasan' : undefined}
        >
          Simpan pengaturan
        </Button>
        {reason && (
          <span id="umum-alasan" className="text-small text-ink-500">
            {reason}
          </span>
        )}
        {(flash || error || lastSaved) && (
          <span role="status">
            <Stamp>
              {error ??
                flash ??
                `Terakhir disimpan ${lastSaved?.jam ?? ''} oleh ${lastSaved?.by ?? ''} · ${lastSaved?.keys.length ?? 0} pengaturan`}
            </Stamp>
          </span>
        )}
      </div>
    </form>
  );
}
