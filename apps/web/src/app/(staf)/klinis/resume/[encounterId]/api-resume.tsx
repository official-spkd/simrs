import { formatTanggalLahir, formatTanggalWaktu } from '@simrs/shared';
import { Alert, PatientBanner } from '@simrs/ui';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/server/api-core';
import { getDischargeSummaryApi, getEncounterContextApi } from '@/lib/server/data/klinis/resume';
import { can, type SessionView } from '@/lib/session-view';
import { ApiResumeClient } from './api-resume-client';

const SEX = { male: 'L', female: 'P', unknown: '-' } as const;

/**
 * K13 · Resume medis mode api (W5b, mockup `Resume.dc.html`): `GET /encounters/:id/discharge-summary` + banner
 * `GET /encounters/:id/context`. Kunjungan tidak dikenal/tenant lain → 404; tanpa relasi → pesan akses dari API.
 */
export async function ApiResume({ session, encounterId }: { session: SessionView; encounterId: string }) {
  let view;
  let ctx;
  try {
    [view, ctx] = await Promise.all([
      getDischargeSummaryApi(encounterId),
      getEncounterContextApi(encounterId),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    if (err instanceof ApiError && err.status !== 401) {
      return (
        <Alert level="critical" title="Resume tidak bisa dimuat">
          {err.message}
        </Alert>
      );
    }
    throw err;
  }
  const p = ctx.patient;
  const s = view.summary;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            {view.kind === 'rawat_inap' ? 'Rawat inap' : 'Rawat jalan'} / {s.location} / Pulang ·{' '}
            {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Resume medis · {p.name}</h1>
        </div>
        <span className="text-small text-ink-700">
          {view.state === 'final' ? 'Pulang' : 'Rencana pulang'} {formatTanggalWaktu(s.dischargeAt)} ·
          kunjungan <span className="font-mono">{view.encounterNumber}</span>
        </span>
      </header>
      <PatientBanner
        name={p.name}
        sex={SEX[p.sex]}
        ageYears={p.ageYears ?? 0}
        birthDate={p.birthDate ? formatTanggalLahir(p.birthDate) : '—'}
        mrn={p.mrn}
        allergies={ctx.allergy.labels}
        guarantor={ctx.coverage?.name ?? 'Umum'}
        attending={ctx.dpjp?.name}
      />
      <ApiResumeClient
        view={view}
        canWrite={can(session, 'clinical', 'write')}
        pdfBase={`/klinis/resume/${view.encounterId}/pdf`}
      />
    </div>
  );
}
