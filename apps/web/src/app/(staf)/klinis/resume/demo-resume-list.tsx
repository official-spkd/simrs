import { formatTanggalWaktu } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { encounterIdOf, patientById, patientByScenario } from '@/lib/demo/fixtures/pasien';
import { RESUME_ENCOUNTERS } from '@/lib/demo/fixtures/rawat-inap';
import { resumeCompleteness } from '@/lib/rawat-inap';
import { getDischargeSummary } from '@/lib/server/data/klinis/resume';
import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';

/**
 * K13 · Pintu resume medis mode presentasi (data fiktif, ADR-0023; dibekukan, jalur api diisi layar W5b di
 * `page.tsx`): bila langkah resume skenario sedang aktif, langsung ke resume pasien skenario; selain itu daftar resume
 * yang sedang disiapkan.
 */
export async function DemoResumeList({ access }: { access: DemoScreenAccess }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const here = scenariosHere(await scenarioRuns(session), 'resume')[0];
  const active = here ? patientByScenario(here.scenario) : undefined;
  if (active) redirect(`/klinis/resume/${encounterIdOf(active.id)}`);

  const rows = (
    await Promise.all(
      RESUME_ENCOUNTERS.map(async (id) => {
        const r = await getDischargeSummary(session, id);
        return r?.kind === 'resume' ? r.summary : null;
      }),
    )
  ).filter((x) => x !== null);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Klinis / Rawat inap / Pulang · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Resume medis</h1>
      </header>
      <ScenarioBanner session={session} screen="resume" />
      <section
        aria-label="Resume disiapkan"
        className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
      >
        <ul className="m-0 list-none p-0">
          {rows.map((s) => {
            const p = patientById(s.patientId);
            const c = resumeCompleteness(s.checklist);
            return (
              <li key={s.encounterId} className="border-b border-line-soft">
                <Link
                  href={`/klinis/resume/${s.encounterId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline"
                >
                  <span className="flex flex-col">
                    <span className="font-semibold text-brand-700">{p?.nama}</span>
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{p?.rm}</span> · {s.location} · rencana pulang{' '}
                      {formatTanggalWaktu(s.dischargeAt)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Chip tone={c.complete ? 'success' : 'warning'}>
                      Kelengkapan {c.done}/{c.total}
                    </Chip>
                    <Chip tone={s.signedAt ? 'success' : 'neutral'}>
                      {s.signedAt ? 'Final · TTE' : 'Draf'}
                    </Chip>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
