import { WORKLIST_VIEWS, type WorklistTask, type WorklistView, worklistSchema } from '@simrs/shared';
import { Alert, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { ApiScreenShell } from '@/components/klinis/encounter-screen';
import { formatTglJam } from '@/lib/rawat-inap';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import type { SessionView } from '@/lib/session-view';

const ROUTE = '/klinis/worklist';
const CLASS_LABEL = { AMB: 'Rawat jalan', EMER: 'IGD', IMP: 'Rawat inap' } as const;
const VIEW_LABEL: Record<WorklistView, string> = {
  tugas: 'Tugas saya',
  dpjp: 'Pasien saya (DPJP)',
  unit: 'Pasien unit',
  shift: 'Shift & serah terima',
};
const TASK_LABEL: Record<WorklistTask['kind'], string> = {
  cosign: 'Co-sign CPPT',
  verify: 'Verifikasi CPPT',
  review_order: 'Tinjau order residen',
  tte_failed: 'TTE gagal',
  ews_high: 'EWS tinggi',
  resume_overdue: 'Resume lewat batas',
  handover: 'Serah terima',
};

/** Layar tindak lanjut per jenis tugas (rute api yang sudah tersambung). */
function taskHref(t: WorklistTask): string | null {
  const e = t.encounterId;
  switch (t.kind) {
    case 'cosign':
    case 'verify':
    case 'handover':
      return e ? `/klinis/cppt?kunjungan=${e}` : null;
    case 'review_order':
      return e ? `/klinis/order/${e}` : null;
    case 'ews_high':
      return e ? `/klinis/rawat-inap/${e}?tab=obs` : null;
    case 'resume_overdue':
      return e ? `/klinis/resume/${e}` : null;
    case 'tte_failed':
      return e ? `/klinis/kelengkapan?kunjungan=${e}` : null;
  }
}

/**
 * K01 · Worklist klinis mode api (`GET /worklist?view=`, izin `clinical.read`, ABAC + audit per pasien di API): tugas
 * tertunda (co-sign, verifikasi > 24 jam, tinjau order residen, TTE gagal, EWS tinggi, resume lewat batas, serah
 * terima) dengan tautan ke layar tindak lanjut, dan pasien saya / unit saya.
 */
export async function ApiWorklist({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const view: WorklistView = WORKLIST_VIEWS.find((v) => v === searchParams.view) ?? 'tugas';
  const crumb = `Klinis / Worklist · ${session.tenant.name}`;
  let data;
  try {
    data = await api(`/api/v1/worklist?view=${view}`, { schema: worklistSchema });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <ApiScreenShell crumb={crumb} title="Worklist klinis">
          <Alert level="warning" title="Akses ditolak">
            {err.message}
          </Alert>
        </ApiScreenShell>
      );
    }
    throw err;
  }
  return (
    <ApiScreenShell crumb={crumb} title="Worklist klinis">
      <nav aria-label="Tampilan worklist" className="flex flex-wrap gap-1.5">
        {WORKLIST_VIEWS.map((v) => (
          <Link
            key={v}
            href={`${ROUTE}?view=${v}`}
            aria-current={v === view ? 'page' : undefined}
            className={cx(
              'inline-flex h-11 items-center rounded-full border px-3.5 text-small no-underline',
              v === view
                ? 'border-transparent bg-nav-active font-semibold text-white'
                : 'border-line-strong bg-white/90 text-ink-700 hover:bg-brand-50/60',
            )}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>
      <section
        aria-label="Tugas tertunda"
        className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <h2 className="m-0 border-b border-line px-4 py-3 text-[15px] font-semibold">
          Tugas tertunda ({data.tasks.length})
        </h2>
        {data.tasks.length === 0 ? (
          <p className="m-0 px-4 py-4 text-small text-ink-500">Tidak ada tugas tertunda.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {data.tasks.map((t, i) => {
              const href = taskHref(t);
              const body = (
                <>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">
                      {TASK_LABEL[t.kind]} · {t.patientName}
                    </span>
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{t.mrn}</span> · {t.label} · sejak {formatTglJam(t.at)}
                      {t.dueAt ? ` · batas ${formatTglJam(t.dueAt)}` : ''}
                    </span>
                  </span>
                  {t.overdue && <Chip tone="danger">Lewat batas</Chip>}
                </>
              );
              return (
                <li
                  key={`${t.kind}-${t.targetId ?? i}`}
                  className="border-b border-line-soft last:border-b-0"
                >
                  {href ? (
                    <Link
                      href={href}
                      className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-brand-50/60"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {view !== 'tugas' && (
        <section
          aria-label="Pasien"
          className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
        >
          <h2 className="m-0 border-b border-line px-4 py-3 text-[15px] font-semibold">
            Pasien ({data.patients.length})
          </h2>
          {data.patients.length === 0 ? (
            <p className="m-0 px-4 py-4 text-small text-ink-500">Tidak ada pasien di tampilan ini.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {data.patients.map((p) => (
                <li key={p.encounterId} className="border-b border-line-soft last:border-b-0">
                  <Link
                    href={
                      p.class === 'IMP'
                        ? `/klinis/rawat-inap/${p.encounterId}`
                        : `/klinis/ringkasan?kunjungan=${p.encounterId}`
                    }
                    className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-brand-50/60"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-caption text-ink-500">
                        RM <span className="font-mono">{p.mrn}</span> · {p.encounterNumber} ·{' '}
                        {CLASS_LABEL[p.class]} · {p.unitName}
                        {p.bed ? ` · ${p.bed}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {p.ews && (
                        <Chip tone={p.ews.risk === 'rendah' ? 'success' : 'danger'}>
                          EWS {p.ews.score} · {p.ews.risk}
                        </Chip>
                      )}
                      {p.pendingTasks > 0 && <Chip tone="warning">{p.pendingTasks} tugas</Chip>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </ApiScreenShell>
  );
}
