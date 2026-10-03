import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Card, Chip } from '@simrs/ui';
import Link from 'next/link';
import { API_BASE_URL, apiGet, type Readiness, readinessSchema } from '@/lib/api';

export const dynamic = 'force-dynamic';

const CHECK_LABEL: Record<string, string> = { database: 'PostgreSQL', redis: 'Redis', storage: 'MinIO (S3)' };

async function loadReadiness(): Promise<Readiness | null> {
  try {
    return await apiGet('/ready', readinessSchema, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  } catch {
    return null;
  }
}

export default async function BerandaPage() {
  const ready = await loadReadiness();
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-h1 font-bold">Beranda</h1>
        <p className="m-0 text-ink-500">{formatTanggalWaktu(new Date())} · lingkungan lokal, data fiktif</p>
      </div>

      <Alert level="info">
        Fase 0: kerangka aplikasi. Menu yang redup akan aktif setelah layarnya dibangun pada fase terkait.
      </Alert>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-h2 font-semibold">Status sistem</h2>
          <span className="font-mono text-caption text-ink-500">{API_BASE_URL}/ready</span>
        </div>
        {ready === null ? (
          <Alert level="warning">
            API belum berjalan atau tidak terjangkau. Jalankan `pnpm dev` dan `docker compose up -d`.
          </Alert>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {Object.entries(ready.checks).map(([name, c]) => (
              <li key={name} className="flex items-center justify-between border-b border-line-soft pb-2">
                <span>{CHECK_LABEL[name] ?? name}</span>
                <Chip tone={c.ok ? 'success' : 'danger'}>
                  {c.ok ? `Siap · ${c.latencyMs ?? 0} ms` : 'Gagal'}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="m-0 text-small text-ink-700">
        Pratinjau token dan komponen dasar: <Link href="/dev/ui">Fondasi UI</Link>.
      </p>
    </div>
  );
}
