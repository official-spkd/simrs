import { formatTanggalLahir } from '@simrs/shared';
import { Chip, PatientBanner } from '@simrs/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { consentIdOf, patientById } from '@/lib/demo/fixtures/pasien';
import { CONSENT_IDS, RESUME_ENCOUNTERS } from '@/lib/demo/fixtures/rawat-inap';
import { BANGSAL } from '@/lib/demo/fixtures/rs';
import { ewsLevel } from '@/lib/rawat-inap';
import { screenById } from '@/lib/screens';
import { getInpatient, inpatientScenarioStep } from '@/lib/server/data/klinis/ranap';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { InpatientWorkspace } from './inpatient-workspace';
import { INPATIENT_TABS, type InpatientTab } from './tabs';
import { NotAdmitted } from './not-admitted';

export const metadata: Metadata = { title: 'Rawat inap' };

type Params = Promise<{ encounterId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/** K04/K07/K12 · Rekam rawat inap satu pasien (mockup `Ranap.dc.html`): CPPT, eMAR, EWS, askep, hasil. */
export default async function RawatInapDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { session, screen, allowed } = await requireDemoScreen('ranap');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { encounterId } = await params;
  const sp = await searchParams;
  const found = await getInpatient(session, encounterId);
  if (!found) notFound();

  if (found.kind === 'belum-dirawat') {
    const p = patientById(found.patientId);
    if (!p) notFound();
    const links = [
      { id: 'igd', label: 'Buka papan IGD' },
      { id: 'bed', label: 'Buka papan tempat tidur' },
    ].flatMap((l) => {
      const r = routeOf(l.id);
      return r ? [{ href: r, label: l.label }] : [];
    });
    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Klinis / Rawat inap · {session.tenant.name}</span>
          <h1 className="m-0 text-h1 font-semibold">Rawat inap · {p.nama}</h1>
        </header>
        <ScenarioBanner session={session} screen="ranap" />
        <NotAdmitted patient={p} links={links} />
      </div>
    );
  }

  const d = found.detail;
  const s = d.summary;
  const p = patientById(s.patientId);
  if (!p) notFound();
  const ward = BANGSAL.find((w) => w.code === s.wardCode);
  const wardName = ward?.name ?? s.wardCode;
  const step = await inpatientScenarioStep(session, p.scenario);
  const tab = INPATIENT_TABS.find((t) => t === sp.tab) ?? 'cppt';
  const guarantor = `${p.penjamin}${p.kelas ? ` ${p.kelas}` : ''}`;
  const primary = s.diagnoses.find((x) => x.primary) ?? s.diagnoses[0];
  const dxText = s.diagnoses
    .filter((x) => x.system === 'ICD-10')
    .map((x) => `${x.code} ${x.label}`)
    .join(' · ');
  const lastNote = [...d.cppt].sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))[0];
  const lv = ewsLevel(s.lastEws, s.lastEwsMaxParam);
  const resume = routeOf('resume');
  const consent = routeOf('consent');
  const order = routeOf('order');
  const links = [
    ...(resume && RESUME_ENCOUNTERS.includes(s.encounterId)
      ? [{ href: `${resume}/${s.encounterId}`, label: 'Siapkan resume medis' }]
      : []),
    ...(consent && CONSENT_IDS.includes(consentIdOf(p.id))
      ? [{ href: `${consent}/${consentIdOf(p.id)}`, label: 'Persetujuan tindakan' }]
      : []),
    ...(order ? [{ href: `${order}/${s.encounterId}`, label: 'Order' }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Klinis / Rawat inap / {wardName} / {s.bed} · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-semibold">
          Rawat inap · {wardName} {s.bed}
        </h1>
      </header>
      <PatientBanner
        name={p.nama}
        sex={p.jk}
        ageYears={p.umur}
        birthDate={formatTanggalLahir(p.tanggalLahir)}
        mrn={p.rm}
        allergies={[...p.alergi]}
        guarantor={guarantor}
        attending={s.dpjp}
      />
      <div className="flex flex-wrap gap-2" aria-label="Status rawat">
        <Chip tone="brand">Hari rawat ke-{s.day}</Chip>
        {dxText && <Chip tone="neutral">{dxText}</Chip>}
        <Chip tone="warning">{s.risk}</Chip>
        <Chip tone={lv.level === 'rendah' ? 'success' : 'danger'}>
          EWS {s.lastEws} · {lv.level}
        </Chip>
      </div>
      <ScenarioBanner session={session} screen="ranap" />
      <InpatientWorkspace
        detail={d}
        patient={{ name: p.nama, rm: p.rm }}
        user={session.user.displayName}
        canCosign={session.role?.code === 'dokter'}
        initialTab={tab as InpatientTab}
        scenario={step}
        links={links}
        summaryRows={[
          { label: 'Diagnosis', value: s.diagnoses.map((x) => `${x.code} ${x.label}`).join(' · ') },
          { label: 'DPJP', value: s.dpjp },
          { label: 'Hari rawat', value: `Ke-${s.day} · ${wardName} ${s.bed} · ${guarantor}` },
          { label: 'Rencana terapi', value: d.plan },
          {
            label: 'Keselamatan',
            value: `${p.alergi.length ? `Alergi ${p.alergi.join(', ')}` : 'Tidak ada alergi tercatat'} · ${s.risk}`,
          },
        ]}
        sbar={{
          s: lastNote ? `${lastNote.a} (${lastNote.author})` : 'Kondisi stabil.',
          b: `${p.riwayat}. Dirawat hari ke-${s.day} dengan ${primary ? `${primary.code} ${primary.label}` : 'diagnosis kerja'}.`,
          a: `EWS terakhir ${s.lastEws} (${lv.level}). ${lv.action}`,
          r: d.plan,
        }}
      />
    </div>
  );
}
