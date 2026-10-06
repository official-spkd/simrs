import { Alert, cx } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { mpiHref, SEVERITY_TONE } from '@/lib/mpi';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { compareSchema, type MatchItem, matchListSchema } from '@/lib/server/mpi';
import { requireSession } from '@/lib/server/session';
import { can } from '@/lib/session-view';
import { ComparePanel } from './compare-panel';

export const metadata: Metadata = { title: 'Master Patient Index' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const paramsSchema = z.object({ pasangan: z.uuid().optional().catch(undefined) });

const STATUS_LABEL: Record<string, string> = { merged: 'Digabung', distinct: 'Bukan duplikat' };

/**
 * P05 · Kemungkinan rekam medis ganda (design/mockups/MPI.dc.html), untuk petugas rekam medis (`patient.merge`).
 * Antrean dari deteksi otomatis saat pendaftaran; setiap pasangan yang ditampilkan dan setiap keputusan
 * tercatat di jejak audit kedua pasien.
 */
export default async function MpiPage({ searchParams }: { searchParams: SearchParams }) {
  const s = await requireSession();
  if (!can(s, 'patient', 'merge')) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Master Patient Index</h1>
        <Alert level="warning" title="Akses ditolak">
          Tinjauan rekam medis ganda khusus petugas rekam medis. Hubungi admin SIM RS bila perlu.
        </Alert>
      </div>
    );
  }
  const raw = await searchParams;
  const p = paramsSchema.parse({ pasangan: typeof raw.pasangan === 'string' ? raw.pasangan : undefined });
  const list = await api('/api/v1/mpi/candidates?status=all', { schema: matchListSchema });
  const selectedId = p.pasangan ?? list.items.find((i) => i.status === 'open')?.id ?? list.items[0]?.id;
  const comparison = selectedId
    ? await api(`/api/v1/mpi/candidates/${selectedId}`, { schema: compareSchema }).catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
        throw err;
      })
    : null;
  const auditHref = comparison && can(s, 'audit', 'read') ? `/sistem/audit?pasien=${comparison.a.id}` : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Rekam medis / Master Patient Index</span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Kemungkinan rekam medis ganda</h1>
        </div>
        <span className="text-small text-ink-500">
          {list.openCount} pasangan menunggu tinjauan · terdeteksi otomatis saat registrasi
        </span>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="antrean-judul"
          className="w-full flex-[1_1_300px] overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card lg:max-w-[340px]"
        >
          <h2 id="antrean-judul" className="m-0 border-b border-line px-4 py-3.5 text-body font-semibold">
            Antrean tinjauan
          </h2>
          {list.items.length === 0 ? (
            <p className="m-0 px-4 py-4 text-small text-ink-500">Tidak ada pasangan yang perlu ditinjau.</p>
          ) : (
            // Antrean panjang bergulir di dalam kotaknya sendiri agar panel banding tetap terlihat (isi berupa
            // tautan, jadi wilayah gulir tetap bisa dijangkau keyboard).
            <ul className="m-0 max-h-[45vh] list-none overflow-y-auto p-0 lg:max-h-[min(65vh,620px)]">
              {list.items.map((item) => (
                <QueueItem key={item.id} item={item} selected={item.id === comparison?.id} />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Perbandingan" className="min-w-0 flex-[999_1_560px]">
          {comparison ? (
            <ComparePanel
              key={`${comparison.id}:${comparison.status}`}
              c={comparison}
              auditHref={auditHref}
            />
          ) : (
            <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-6 text-small text-ink-500">
              {p.pasangan
                ? 'Pasangan tidak ditemukan.'
                : 'Pilih pasangan di antrean. Pasangan baru muncul otomatis saat ada pendaftaran yang mirip dengan rekam medis lama.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function QueueItem({ item, selected }: { item: MatchItem; selected: boolean }) {
  const decided = item.status !== 'open';
  return (
    <li>
      <Link
        href={mpiHref(item.id)}
        aria-current={selected ? 'true' : undefined}
        className={cx(
          'flex flex-col gap-1 border-b border-l-[3px] border-b-line-soft px-4 py-3 text-ink-900 no-underline',
          selected
            ? 'border-l-brand-600 bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
            : 'border-l-transparent bg-transparent hover:bg-brand-50/60',
        )}
      >
        <span className="flex justify-between gap-2">
          <span className="font-semibold">
            {item.a.name} / {item.b.name}
          </span>
          <span
            className={cx(
              'shrink-0 font-bold',
              decided
                ? item.status === 'merged'
                  ? 'text-success'
                  : 'text-ink-500'
                : SEVERITY_TONE[item.severity],
            )}
          >
            {decided ? STATUS_LABEL[item.status] : `${item.score}%`}
          </span>
        </span>
        <span className="text-caption text-ink-500">
          {item.a.mrn} · {item.b.mrn} — {item.summary}
        </span>
      </Link>
    </li>
  );
}
