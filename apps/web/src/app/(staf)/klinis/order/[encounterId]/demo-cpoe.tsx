import { Chip, Icon } from '@simrs/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import type { ScenarioHandoff } from '@/components/klinis/cpoe-scenario-panel';
import { CpoeWorkspace, type ScenarioGate } from '@/components/klinis/cpoe-workspace';
import { KlinisPatientHeader } from '@/components/klinis/patient-header';
import { ScenarioBanner } from '@/components/scenario-banner';
import { consentIdOf, patientByEncounterId } from '@/lib/demo/fixtures/pasien';
import { egfrLow } from '@/lib/klinis';
import { lastSent } from '@/lib/klinis-order-toko';
import { screenById } from '@/lib/screens';
import { getCpoeContext } from '@/lib/server/data/klinis/cpoe';
import { getPoliWorklist } from '@/lib/server/data/klinis/poli';
import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import { readDomain } from '@/lib/server/demo/state';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';

/** Tugas CDS skenario: ikuti = 'ganti', override beralasan = 'lanjut' (rawat jalan: glimepirid; IGD: klopidogrel). */
const GATES: Record<string, ScenarioGate> = {
  'rawat-jalan': { catalogId: 'glimepirid-2', task: 'cds', follow: 'ganti', override: 'lanjut' },
  'igd-ranap': { catalogId: 'klopidogrel-75', task: 'cds', follow: 'ganti', override: 'lanjut' },
};

/**
 * K09 · CPOE + CDS mode presentasi (mockup `CPOE.dc.html`, data dummy fiktif + order tersimpan di toko demo
 * `klinis-order`, ADR-0023/0085; jalur api diisi layar W2 di `page.tsx`). Langkah Simulasi `resep` (Tn. Suryo) dan `asesmen-dokter`/`tata-laksana` (Tn. Hartono)
 * dibawakan lewat kontrol asli layar ini; kunjungan pasien skenario mengikuti langkah skenario (katalog nonaktif,
 * kirim hanya lewat tugas skenario). Persetujuan tindakan Tn. Hartono hanya bisa diselesaikan di tablet persetujuan
 * (tanda tangan pasien + saksi + TTE dokter).
 */
export async function DemoCpoe({ access, encounterId }: { access: DemoScreenAccess; encounterId: string }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const ctx = await getCpoeContext(session, encounterId);
  if (!ctx) notFound();
  const [runs, orderStore] = await Promise.all([scenarioRuns(session), readDomain('klinis-order')]);
  const scenario = patientByEncounterId(encounterId)?.scenario;
  const here = scenario ? scenariosHere(runs, 'order').find((h) => h.scenario === scenario) : undefined;
  const hasTask = (id: string) => Boolean(here?.step.tasks.some((t) => t.id === id));
  const gate = here && hasTask('cds') ? (GATES[here.scenario] ?? null) : null;
  const tablet = screenById('consent');
  const handoff: ScenarioHandoff | null =
    here?.scenario === 'igd-ranap' && hasTask('consent')
      ? {
          task: 'consent',
          href: tablet && tablet.status !== 'belum' ? `${tablet.route}/${consentIdOf(ctx.patient.id)}` : null,
          linkLabel: 'Buka tablet persetujuan',
          note: 'Pasien dan saksi menandatangani di tablet, lalu TTE dokter. Tidak bisa diselesaikan dari CPOE.',
        }
      : null;
  const links = (['lab', 'farmasi'] as const).flatMap((id) => {
    const s = screenById(id);
    return s && s.status !== 'belum' ? [{ href: s.route, label: `Lihat di ${s.label}` }] : [];
  });
  const poli = screenById('poli');
  // "Kembali ke pemeriksaan" hanya bila kunjungan poli pasien ini ada di antrean hari ini (bukan berujung 404).
  const poliHref =
    ctx.setting === 'rawat-jalan' &&
    poli &&
    poli.status !== 'belum' &&
    (await getPoliWorklist(session)).items.some((i) => i.patientId === ctx.patient.id)
      ? `${poli.route}?pasien=${ctx.patient.id}`
      : null;
  const lowEgfr = egfrLow(ctx.egfr);
  const signature = ctx.orders.map((o) => `${o.id}:${o.status}:${o.override ?? ''}`).join('|');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          {ctx.breadcrumb} · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Order &amp; resep (CPOE)</h1>
      </header>
      <KlinisPatientHeader
        patient={ctx.patient}
        attending={ctx.doctor}
        actions={
          <>
            {ctx.weightKg && <Chip tone="neutral">BB {ctx.weightKg} kg</Chip>}
            <Chip
              tone={lowEgfr ? 'warning' : 'neutral'}
              icon={lowEgfr ? <Icon name="arrowDown" size={13} strokeWidth={2.2} /> : undefined}
            >
              eGFR {ctx.egfr ?? 'belum ada'}
              {lowEgfr ? ' · rendah' : ''}
            </Chip>
            {poliHref && (
              <Link
                href={poliHref}
                className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3 text-small font-medium text-ink-900 no-underline hover:bg-brand-50/60"
              >
                Kembali ke pemeriksaan
              </Link>
            )}
          </>
        }
      />
      <ScenarioBanner session={session} screen="order" />
      <CpoeWorkspace
        key={signature}
        ctx={ctx}
        signer={session.user.displayName}
        binding={here ? { here, rev: runs.rev } : null}
        scenarioOwned={Boolean(scenario)}
        scenarioGate={gate}
        sendTask={here && hasTask('tte') ? 'tte' : null}
        handoff={handoff}
        links={links}
        rev={orderStore.rev}
        lastSent={scenario ? null : lastSent(orderStore.state, ctx.encounterId)}
      />
    </div>
  );
}
