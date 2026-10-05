import {
  formatTanggal,
  formatTanggalWaktu,
  PIN_DEVICE_DAYS,
  PIN_IDLE_MINUTES,
  PIN_MAX_ATTEMPTS,
  PIN_SESSION_HOURS,
} from '@simrs/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { api } from '@/lib/server/api';
import { cookieNames, parsePinTokens, pinTokenId } from '@/lib/server/cookies';
import { pinDevicesSchema } from '@/lib/server/schemas';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { canRegisterPin, pinUnavailableText } from '@/lib/session-view';
import { RegisterPinForm, RemovePinButton } from './pin-forms';

export const metadata: Metadata = { title: 'PIN masuk cepat' };

/**
 * P02 · PIN masuk cepat per perangkat terdaftar (docs/05 §1, ADR-0024): daftarkan peramban ini untuk posisi sesi
 * saat ini, lihat dan hapus perangkat ber-PIN. Daftar, pakai, gagal, dan hapus tercatat di jejak audit.
 */
export default async function PinPage() {
  const s = await requireSession();
  const devices = await api('/api/v1/auth/pin/devices', { schema: pinDevicesSchema });
  const store = await cookies();
  const here = new Set(
    parsePinTokens(store.get(cookieNames(webEnv().secureCookies).pinDevices)?.value).map(pinTokenId),
  );
  const eligible = canRegisterPin(s);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-h1 font-semibold">PIN masuk cepat</h1>
        <p className="m-0 text-small text-ink-700">
          Di komputer unit yang sering dipakai bergantian, masuk cukup dengan memilih nama lalu mengetik PIN 6
          digit. PIN hanya berlaku di perangkat tempat ia didaftarkan, untuk posisi saat didaftarkan, selama{' '}
          {PIN_DEVICE_DAYS} hari. Sesi dari PIN berakhir setelah {PIN_SESSION_HOURS} jam atau{' '}
          {PIN_IDLE_MINUTES} menit tanpa aktivitas. Salah {PIN_MAX_ATTEMPTS} kali, PIN di perangkat itu
          dinonaktifkan.
        </p>
      </header>

      <section
        aria-labelledby="pin-daftar"
        className="flex flex-col gap-4 rounded-card border border-line bg-card p-5"
      >
        <div className="flex flex-col gap-0.5">
          <h2 id="pin-daftar" className="m-0 text-h2 font-semibold">
            Daftarkan perangkat ini
          </h2>
          {eligible && (
            <span className="text-small text-ink-700">
              Untuk posisi {s.role?.name} · {s.unit?.name}. Hanya di komputer milik RS; jangan di perangkat
              pribadi yang dipakai orang lain.
            </span>
          )}
        </div>
        {eligible ? (
          <RegisterPinForm
            defaultName={`Komputer ${s.unit?.name ?? 'unit'}`}
            replacing={devices.some((d) => here.has(d.id))}
          />
        ) : (
          <p className="m-0 text-small text-ink-700">{pinUnavailableText(s.pin?.reason, s.role?.name)}</p>
        )}
      </section>

      <section aria-labelledby="pin-perangkat" className="flex flex-col gap-3">
        <h2 id="pin-perangkat" className="m-0 text-h2 font-semibold">
          Perangkat ber-PIN
        </h2>
        {devices.length === 0 ? (
          <p className="m-0 rounded-card border border-line bg-card px-4 py-4 text-small text-ink-500">
            Belum ada perangkat ber-PIN yang berlaku.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-card px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-ink-900">
                    {d.name}
                    {here.has(d.id) && <span className="font-normal text-brand-700"> · perangkat ini</span>}
                    {d.current && <span className="font-normal text-ink-500"> · sesi ini</span>}
                  </span>
                  <span className="text-small text-ink-700">
                    {d.roleName}
                    {d.unitName ? ` · ${d.unitName}` : ''}
                  </span>
                  <span className="text-caption text-ink-500">
                    Didaftarkan {formatTanggal(d.createdAt)} · terakhir dipakai{' '}
                    {d.lastUsedAt ? formatTanggalWaktu(d.lastUsedAt) : 'belum pernah'} · berlaku sampai{' '}
                    {formatTanggal(d.expiresAt)}
                  </span>
                </div>
                <RemovePinButton deviceId={d.id} name={d.name} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
