import { formatJam, formatTanggalLahir } from '@simrs/shared';
import { Chip, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { consentIdOf, patientById } from '@/lib/demo/fixtures/pasien';
import { CONSENT_IDS, RESUME_ENCOUNTERS } from '@/lib/demo/fixtures/rawat-inap';
import { BANGSAL } from '@/lib/demo/fixtures/rs';
import { canAdministerMeds, ewsLevel } from '@/lib/rawat-inap';
import { emarGiven, emarLog } from '@/lib/rme-toko';
import { screenById } from '@/lib/screens';
import { getInpatient, inpatientScenarioStep } from '@/lib/server/data/klinis/ranap';
import { readRekam } from '@/lib/server/data/klinis/rekam';
import { criticalNotices } from '@/lib/server/data/klinis/worklist';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { InpatientWorkspace } from './inpatient-workspace';
import { INPATIENT_TABS, type InpatientTab } from './tabs';
import { NotAdmitted } from './not-admitted';

function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/**
 * K04/K07/K12 · Rekam rawat inap satu pasien mode presentasi (mockup `Ranap.dc.html`): CPPT, eMAR, EWS, askep, hasil
 * (data fiktif + toko demo `rekam-medis`, ADR-0023/0085; jalur api diisi layar W4 di `page.tsx`).
 */
export async function DemoRawatInapDetail({
  access,
  encounterId,
  tab: wantedTab,
}: {
  access: DemoScreenAccess;
  encounterId: string;
  tab: string | null;
}) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
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
  const [step, rekam, notices] = await Promise.all([
    inpatientScenarioStep(session, p.scenario),
    readRekam(),
    criticalNotices(session),
  ]);
  // Aliran masuk: nilai kritis pasien ini dari Laboratorium / Pusat hasil kritis (domain `hasil-kritis`).
  const critical = notices.filter((c) => c.rm === p.rm);
  const roleCode = session.role?.code ?? null;
  const tab = INPATIENT_TABS.find((t) => t === wantedTab) ?? 'cppt';
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
  // Baris tautan cepat yang selalu terlihat (mockup Ranap). Pasien tanpa draf resume / dokumen persetujuan sendiri
  // diarahkan ke daftar layar itu; layar yang belum ada di presentasi tertulis "belum tersedia".
  const resumeHref = resume
    ? RESUME_ENCOUNTERS.includes(s.encounterId)
      ? `${resume}/${s.encounterId}`
      : resume
    : null;
  const quickLinks = [
    { label: 'Order & resep (CPOE)', href: order ? `${order}/${s.encounterId}` : null },
    {
      label: 'Persetujuan tindakan',
      href: consent
        ? CONSENT_IDS.includes(consentIdOf(p.id))
          ? `${consent}/${consentIdOf(p.id)}`
          : consent
        : null,
    },
    { label: 'Resume medis', href: resumeHref },
    { label: 'Perencanaan pulang', href: resumeHref },
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
      {critical.length > 0 && (
        <section
          aria-label="Nilai kritis pasien"
          className="flex flex-col gap-1 rounded-card border border-danger-border bg-[#FFF8F7] px-4 py-3"
        >
          {critical.map((c) => (
            <span key={`${c.test}-${c.valueText}`} className="text-small">
              <span className="font-semibold text-danger-strong">
                Nilai kritis: {c.test} · {c.valueText}
              </span>
              <span className="text-ink-700">
                {' · '}
                {c.report
                  ? `dilaporkan ${c.report.reportedBy} ke ${c.report.recipient} (${c.report.recipientRole}) ${formatJam(c.report.reportedAt)} · read-back`
                  : 'belum dilaporkan lab ke penerima'}
              </span>
            </span>
          ))}
        </section>
      )}
      <nav aria-label="Tautan cepat pasien" className="flex flex-wrap gap-2">
        {quickLinks.map((l) =>
          l.href ? (
            <Link
              key={l.label}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3.5 text-small font-semibold text-ink-900 no-underline"
            >
              {l.label}
            </Link>
          ) : (
            <span
              key={l.label}
              aria-disabled="true"
              className="inline-flex min-h-11 items-center rounded-control border border-line bg-muted px-3.5 text-small text-ink-500"
            >
              {l.label} · belum tersedia
            </span>
          ),
        )}
      </nav>
      <ScenarioBanner session={session} screen="ranap" />
      <InpatientWorkspace
        detail={d}
        patient={{ name: p.nama, rm: p.rm }}
        user={session.user.displayName}
        userRole={session.role?.name ?? null}
        canCosign={roleCode === 'dokter'}
        canNurse={roleCode === 'perawat' || roleCode === 'bidan'}
        canObserve={canAdministerMeds(roleCode)}
        rev={rekam.rev}
        storedGiven={s.scenario ? {} : emarGiven(rekam.state, s.encounterId)}
        storedLog={s.scenario ? [] : emarLog(rekam.state, s.encounterId)}
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
