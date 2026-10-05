import { DEVICE_HOME, DEVICE_KIND_LABEL, type DevicePrincipalKind, type DeviceSelf } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import Link from 'next/link';

/** Teks untuk pasien di layar perangkat selama jalur datanya belum tersambung (potongan 6). */
const NOT_CONNECTED: Record<DevicePrincipalKind, string> = {
  kiosk:
    'Anjungan pendaftaran mandiri belum dapat dipakai. Silakan ambil nomor antrean di loket pendaftaran.',
  queue_display: 'Papan antrean belum tersambung. Nomor antrean dipanggil langsung oleh petugas.',
};

/** TV yang belum diikat admin ke papan antrean (Akses → Perangkat anjungan dan display). */
const UNBOUND_DISPLAY =
  'Perangkat ini belum diikat ke papan antrean. Admin SIM RS memilih papannya di Pengguna & akses → Perangkat anjungan dan display.';

/**
 * ADR-0027 · Layar perangkat mode api yang dibuka perangkat terdaftar: identitas perangkat (RS, unit, nama) untuk
 * petugas yang memasang, plus pesan untuk pasien (TV belum diikat ke papan, atau anjungan sebelum potongan 6).
 */
export function DeviceScreen({
  kind,
  device,
  problem,
}: {
  kind: DevicePrincipalKind;
  device: DeviceSelf;
  /** Sebab papan tidak bisa dibuka (pesan API), mis. papan belum punya layanan poli aktif. */
  problem?: string;
}) {
  const mismatch = device.kind !== kind;
  const message =
    problem ?? (kind === 'queue_display' && !device.queueDisplay ? UNBOUND_DISPLAY : NOT_CONNECTED[kind]);
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-card border border-line bg-white p-8">
        <p className="m-0 text-caption text-ink-500">{device.tenant.name}</p>
        <h1 className="m-0 text-h1 font-semibold">{DEVICE_KIND_LABEL[kind]}</h1>
        {mismatch ? (
          <Alert level="warning" title="Perangkat untuk layar lain">
            Perangkat ini terdaftar sebagai {DEVICE_KIND_LABEL[device.kind]}.{' '}
            <Link href={DEVICE_HOME[device.kind]}>Buka {DEVICE_KIND_LABEL[device.kind]}</Link>
          </Alert>
        ) : (
          <Alert level="info" title="Belum tersambung">
            {message}
          </Alert>
        )}
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-small">
          <dt className="text-ink-500">Perangkat</dt>
          <dd className="m-0" data-testid="nama-perangkat">
            {device.name}
          </dd>
          <dt className="text-ink-500">Unit</dt>
          <dd className="m-0">{device.unit.name}</dd>
          {device.queueDisplay && (
            <>
              <dt className="text-ink-500">Papan antrean</dt>
              <dd className="m-0">{device.queueDisplay.name}</dd>
            </>
          )}
        </dl>
      </div>
    </main>
  );
}
