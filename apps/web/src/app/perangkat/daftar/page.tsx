import { DEVICE_HOME, DEVICE_KIND_LABEL } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { safeNextPath } from '@/lib/safe-path';
import { getDevice } from '@/lib/server/device';
import { webEnv } from '@/lib/server/web-env';
import { EnrolForm } from './enrol-form';

export const metadata: Metadata = { title: 'Daftarkan perangkat' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * ADR-0027 · Pendaftaran perangkat anjungan/TV (publik, tanpa login staf). Admin membuat perangkat di
 * Sistem → Pengguna dan akses → Perangkat, lalu kode sekali pakainya diketik di sini, di perangkat itu sendiri.
 */
export default async function DaftarPerangkatPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const lanjut = safeNextPath(typeof sp.lanjut === 'string' ? sp.lanjut : null, '');
  const env = webEnv();
  const current = await getDevice().catch(() => null);
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#E9EEF2] p-6 text-ink-900">
      <div className="flex w-full max-w-xl flex-col gap-5 rounded-card border border-line bg-white p-8">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-500">SIM RS · Perangkat anjungan dan display</span>
          <h1 className="m-0 text-h1 font-semibold">Daftarkan perangkat</h1>
          <p className="m-0 text-small text-ink-700">
            Perangkat ini akan membuka layar anjungan atau display antrean tanpa akun staf. Minta kode
            pendaftaran ke admin SIM RS.
          </p>
        </div>
        {current && (
          <Alert level="info" title="Perangkat sudah terdaftar">
            {current.name} ({DEVICE_KIND_LABEL[current.kind]}, {current.unit.name}).{' '}
            <Link href={DEVICE_HOME[current.kind]}>Buka {DEVICE_KIND_LABEL[current.kind]}</Link>. Kode baru
            akan menggantikan pendaftaran ini di peramban ini.
          </Alert>
        )}
        <EnrolForm
          lanjut={lanjut}
          tenantCodeField={env.tenantCodeField}
          defaultTenantCode={env.loginTenantCode}
        />
      </div>
    </main>
  );
}
