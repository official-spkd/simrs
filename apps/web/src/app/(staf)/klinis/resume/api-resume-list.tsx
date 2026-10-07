import { Alert, Chip } from '@simrs/ui';
import Link from 'next/link';
import { ApiError } from '@/lib/server/api-core';
import { getResumeWorklistApi } from '@/lib/server/data/klinis/resume';
import type { SessionView } from '@/lib/session-view';

/**
 * K13 · Pintu resume medis mode api (W5b): pasien yang saya rawat sebagai DPJP/rawat bersama
 * (`GET /worklist?view=dpjp`), rawat inap dan rawat jalan, menuju resume per kunjungan.
 */
export async function ApiResumeList({ session }: { session: SessionView }) {
  let wl;
  try {
    wl = await getResumeWorklistApi();
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      return (
        <Alert level="critical" title="Daftar resume tidak bisa dimuat">
          {err.message}
        </Alert>
      );
    }
    throw err;
  }
  const rows = wl.patients.filter((p) => p.class !== 'EMER');
  const overdue = new Set(wl.tasks.filter((t) => t.kind === 'resume_overdue').map((t) => t.encounterId));
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Pulang · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Resume medis</h1>
      </header>
      {rows.length === 0 ? (
        <Alert level="info" title="Belum ada pasien">
          Tidak ada pasien yang Anda rawat sebagai DPJP saat ini.
        </Alert>
      ) : (
        <section
          aria-label="Pasien saya"
          className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
        >
          <ul className="m-0 list-none p-0">
            {rows.map((p) => (
              <li key={p.encounterId} className="border-b border-line-soft">
                <Link
                  href={`/klinis/resume/${p.encounterId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-brand-50/60"
                >
                  <span className="flex flex-col">
                    <span className="font-semibold text-brand-700">{p.name}</span>
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{p.mrn}</span> · {p.unitName}
                      {p.bed ? ` ${p.bed}` : ''} · {p.encounterNumber}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Chip tone="neutral">{p.class === 'IMP' ? 'Rawat inap' : 'Rawat jalan'}</Chip>
                    {overdue.has(p.encounterId) && <Chip tone="warning">Resume lewat batas</Chip>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
