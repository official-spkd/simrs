'use client';

import { DEVICE_KIND_LABEL, DEVICE_PRINCIPAL_KINDS, formatJam } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useActionState, useState } from 'react';
import { Done, ErrorText } from '../parts';
import { inputClass, selectClass } from '../styles';
import { createDeviceAction, type DeviceActionResult, revokeDeviceAction } from './actions';

/** Daftarkan anjungan/TV baru; kode pendaftaran tampil SEKALI untuk diketik di perangkatnya. */
export function CreateDevice({ units }: { units: Array<{ value: string; label: string }> }) {
  const [state, action, pending] = useActionState<DeviceActionResult, FormData>(createDeviceAction, {});
  return (
    <section
      aria-labelledby="daftar-perangkat"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <h2 id="daftar-perangkat" className="m-0 text-h3 font-semibold">
        Daftarkan perangkat
      </h2>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Jenis
          <select name="kind" className={selectClass} defaultValue="kiosk">
            {DEVICE_PRINCIPAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {DEVICE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[220px] flex-[1_1_220px] flex-col gap-1 text-small font-semibold text-ink-700">
          Nama perangkat
          <input
            name="name"
            required
            minLength={3}
            maxLength={60}
            placeholder="mis. Anjungan lobi utama"
            className={inputClass}
            aria-invalid={Boolean(state.fields?.name)}
          />
        </label>
        <label className="flex min-w-[200px] flex-col gap-1 text-small font-semibold text-ink-700">
          Unit
          <select name="unitId" className={selectClass} defaultValue="" required>
            <option value="" disabled>
              Pilih unit
            </option>
            {units.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Memproses…' : 'Buat kode pendaftaran'}
        </Button>
      </form>
      <ErrorText message={state.error ?? Object.values(state.fields ?? {})[0]} />
      {state.created && (
        <div
          role="status"
          className="flex flex-col gap-1.5 rounded-control border border-warning-border bg-warning-bg px-3.5 py-3"
        >
          <span className="text-small font-semibold text-warning">
            Kode pendaftaran {state.created.name} (tampil sekali)
          </span>
          <span data-testid="kode-pendaftaran" className="font-mono text-[28px] font-bold tracking-[0.15em]">
            {state.created.code}
          </span>
          {state.created.kind === 'lab_analyzer' ? (
            <span className="text-small text-ink-700">
              Masukkan kode ini di konfigurasi gateway analyzer sebelum pukul{' '}
              {formatJam(state.created.expiresAt)}. Gateway menukarnya sendiri dengan kredensial dan kunci
              tanda tangan. Kode hanya bisa dipakai sekali; jangan kirim lewat pesan.
            </span>
          ) : (
            <span className="text-small text-ink-700">
              Buka <strong>/perangkat/daftar</strong> di perangkat itu dan ketik kode ini sebelum pukul{' '}
              {formatJam(state.created.expiresAt)}. Kode hanya bisa dipakai sekali; jangan kirim lewat pesan.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Cabut perangkat dengan konfirmasi; layar perangkat itu langsung tidak bisa dipakai lagi. */
export function RevokeDevice({ deviceId, label }: { deviceId: string; label: string }) {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<DeviceActionResult, FormData>(revokeDeviceAction, {});
  if (state.ok) return <Done message={state.message} />;
  if (!asking) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)} aria-label={`Cabut ${label}`}>
        Cabut
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="deviceId" value={deviceId} />
      <span className="text-small text-ink-700">
        Cabut {label}? Layar di perangkat itu berhenti; daftarkan ulang dengan kode baru bila perlu.
      </span>
      <ErrorText message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? 'Memproses…' : 'Cabut perangkat'}
        </Button>
        <Button size="sm" onClick={() => setAsking(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
