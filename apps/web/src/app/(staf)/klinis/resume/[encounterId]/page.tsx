import { formatTanggalLahir, formatTanggalWaktu } from '@simrs/shared';
import { Alert, PatientBanner } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { screenById } from '@/lib/screens';
import { getDischargeSummary } from '@/lib/server/data/klinis/resume';
import { scenarioSteps } from '@/lib/server/data/klinis/shared';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { PrintButton } from './print-button';
import { ResumeClient } from './resume-client';

export const metadata: Metadata = { title: 'Resume medis' };

type Params = Promise<{ encounterId: string }>;

function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/** K13 · Resume medis pulang (mockup `Resume.dc.html`). Mode presentasi: data fiktif (ADR-0023). */
export default async function ResumePage({ params }: { params: Params }) {
  const { session, screen, allowed } = await requireDemoScreen('resume');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { encounterId } = await params;
  const found = await getDischargeSummary(session, encounterId);
  if (!found) notFound();
  const p = patientById(found.kind === 'resume' ? found.summary.patientId : found.patientId);
  if (!p) notFound();
  const ranap = routeOf('ranap');
  const banner = (
    <PatientBanner
      name={p.nama}
      sex={p.jk}
      ageYears={p.umur}
      birthDate={formatTanggalLahir(p.tanggalLahir)}
      mrn={p.rm}
      allergies={[...p.alergi]}
      guarantor={`${p.penjamin}${p.kelas ? ` ${p.kelas}` : ''}`}
      attending={found.kind === 'resume' ? found.summary.dpjp : undefined}
    />
  );

  if (found.kind === 'belum-disiapkan') {
    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Klinis / Rawat inap / Pulang · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Resume medis · {p.nama}</h1>
        </header>
        {banner}
        <Alert level="info" title="Resume belum disiapkan">
          Pasien belum direncanakan pulang oleh DPJP. Draf resume terbentuk otomatis dari CPPT, hasil, dan
          eMAR saat rencana pulang dibuat.{' '}
          {ranap && <Link href={`${ranap}/${encounterId}`}>Buka rekam rawat inap</Link>}
        </Alert>
      </div>
    );
  }

  const s = found.summary;
  const [step] = p.scenario
    ? await scenarioSteps(session, [[p.scenario === 'igd-ranap' ? 'igd-ranap' : 'elektif-btn', 'resume']])
    : [];
  const los = Math.max(1, Math.round((Date.parse(s.dischargeAt) - Date.parse(s.admittedAt)) / 86_400_000));
  const klaim = routeOf('klaim');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Rawat inap / {s.location} / Pulang · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Resume medis · {p.nama}</h1>
          <span className="text-small text-ink-700">
            Rencana pulang {formatTanggalWaktu(s.dischargeAt)} · batas resume final 24 jam setelah pulang
          </span>
        </div>
        <PrintButton />
      </header>
      {banner}
      <ScenarioBanner session={session} screen="resume" />
      <ResumeClient
        summary={s}
        los={los}
        scenario={step ?? null}
        canSign={session.role?.code === 'dokter'}
        klaimHref={klaim}
      />
    </div>
  );
}
