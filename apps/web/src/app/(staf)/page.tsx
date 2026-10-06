import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Card, Chip } from '@simrs/ui';
import Link from 'next/link';
import { loadReadiness } from '@/lib/server/readiness';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { isSuperadmin } from '@/lib/session-view';
import { readinessCheckLabel } from '@/lib/system-status';

export default async function BerandaPage() {
  const s = await requireSession();
  const operator = isSuperadmin(s);
  const ready = operator ? await loadReadiness() : null;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Beranda</h1>
        <p className="m-0 text-ink-500">
          {formatTanggalWaktu(new Date())} · {s.tenant.name}
        </p>
      </div>

      <Card className="flex flex-col gap-1 p-5">
        <span className="text-h2 font-semibold">Selamat datang, {s.user.displayName}</span>
        <span className="text-ink-700">
          Anda masuk sebagai{' '}
          <strong>{s.demoAllAccess ? 'Superadmin demo · semua layar' : s.role?.name}</strong>
          {s.unit ? (
            <>
              {' '}
              di <strong>{s.unit.name}</strong>
            </>
          ) : null}
          . Hak akses mengikuti peran dan unit ini.
        </span>
      </Card>

      {webEnv().dataSource === 'demo' ? (
        <Alert level="info" title="Mode presentasi">
          Semua data di layar ini fiktif. Mulai dari <Link href="/simulasi">Simulasi pasien</Link> untuk
          membawakan cerita langkah demi langkah; menu yang redup adalah layar yang sedang disiapkan.
        </Alert>
      ) : (
        <Alert level="info">
          Fase 1: menu yang redup akan aktif setelah layarnya dibangun pada fase terkait.
        </Alert>
      )}

      {operator && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="m-0 text-h2 font-semibold">Status sistem</h2>
          {ready === null ? (
            <Alert level="warning">API belum berjalan atau tidak terjangkau.</Alert>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {Object.entries(ready.checks).map(([name, c]) => (
                <li key={name} className="flex items-center justify-between border-b border-line-soft pb-2">
                  <span>{readinessCheckLabel(name, c.driver)}</span>
                  <Chip tone={c.ok ? 'success' : 'danger'}>
                    {c.ok ? `Siap · ${c.latencyMs ?? 0} ms` : 'Gagal'}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-small text-ink-700">
            Panduan pengembang: <Link href="/superadmin/panduan">Panduan sistem</Link> · pratinjau komponen:{' '}
            <Link href="/dev/ui">Fondasi UI</Link>.
          </p>
        </Card>
      )}
    </div>
  );
}
