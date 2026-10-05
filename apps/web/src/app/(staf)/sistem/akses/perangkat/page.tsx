import {
  DEVICE_KIND_LABEL,
  DEVICE_STATUS_LABEL,
  type DeviceStatus,
  deviceViewSchema,
  formatTanggalWaktu,
} from '@simrs/shared';
import { Alert, Chip, type ChipTone } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { unitsSchema } from '@/lib/server/iam';
import { requireSession } from '@/lib/server/session';
import { can } from '@/lib/session-view';
import { CreateDevice, RevokeDevice } from './device-forms';

export const metadata: Metadata = { title: 'Perangkat anjungan dan display' };

const devicePageSchema = z.object({ items: z.array(deviceViewSchema), nextCursor: z.string().nullable() });

const STATUS_TONE: Record<DeviceStatus, ChipTone> = {
  pending: 'warning',
  active: 'success',
  expired: 'neutral',
  revoked: 'danger',
};

/**
 * ADR-0027 · Perangkat anjungan dan display TV (prinsipal perangkat). Hak baca = `iam.users.read`; daftar dan cabut =
 * `iam.users.write` (sama dengan pencabutan PIN perangkat). Setiap perubahan ditegakkan + diaudit API.
 */
export default async function PerangkatPage() {
  const s = await requireSession();
  if (!can(s, 'iam.users', 'read')) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="m-0 text-h1 font-semibold">Perangkat anjungan dan display</h1>
        <Alert level="warning" title="Akses ditolak">
          Peran Anda tidak berizin melihat perangkat. Hubungi admin SIM RS bila perlu.
        </Alert>
      </div>
    );
  }
  const canWrite = can(s, 'iam.users', 'write');
  const [devices, units] = await Promise.all([
    api('/api/v1/iam/devices?limit=200', { schema: devicePageSchema }),
    canWrite && can(s, 'facility', 'read')
      ? api('/api/v1/facility/units?limit=200', { schema: unitsSchema })
      : Promise.resolve(null),
  ]);
  const unitOptions = (units?.items ?? [])
    .filter((u) => u.active)
    .map((u) => ({ value: u.id, label: u.name }));
  const rows = [...devices.items].reverse();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          <Link href="/sistem/akses">Sistem / Pengguna dan akses</Link> / Perangkat
        </span>
        <h1 className="m-0 text-h1 font-semibold">Perangkat anjungan dan display</h1>
        <p className="m-0 max-w-3xl text-small text-ink-700">
          Anjungan mandiri dan TV antrean masuk sebagai perangkat terdaftar per unit, bukan dengan akun staf.
          Perangkat hanya bisa membuka layar jenisnya dan tidak bisa membuka data pasien di layar staf.
        </p>
      </header>

      {canWrite && <CreateDevice units={unitOptions} />}

      <section
        aria-label="Daftar perangkat"
        className="overflow-hidden rounded-card border border-line bg-card"
      >
        {rows.length === 0 ? (
          <p className="m-0 p-4 text-small text-ink-500">Belum ada perangkat terdaftar.</p>
        ) : (
          <table className="w-full border-collapse text-small">
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-500">
                <th className="px-4 py-2.5 font-semibold">Perangkat</th>
                <th className="px-4 py-2.5 font-semibold">Unit</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Terakhir dipakai</th>
                <th className="px-4 py-2.5 font-semibold">
                  <span className="sr-only">Aksi</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-caption text-ink-500">{DEVICE_KIND_LABEL[d.kind]}</div>
                  </td>
                  <td className="px-4 py-2.5">{d.unit.name}</td>
                  <td className="px-4 py-2.5">
                    <Chip tone={STATUS_TONE[d.status]}>{DEVICE_STATUS_LABEL[d.status]}</Chip>
                  </td>
                  <td className="px-4 py-2.5">{d.lastUsedAt ? formatTanggalWaktu(d.lastUsedAt) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canWrite && (d.status === 'active' || d.status === 'pending') && (
                      <RevokeDevice deviceId={d.id} label={d.name} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
