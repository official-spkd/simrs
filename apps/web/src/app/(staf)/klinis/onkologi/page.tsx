import { formatJam, formatTanggal, formatTanggalLahir } from '@simrs/shared';
import { PatientBanner } from '@simrs/ui';
import type { Metadata } from 'next';
import { KeyValues, PageHead, Panel } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ChemoBoard } from '@/components/onkologi/chemo-board';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { getOncology } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Onkologi' };

/**
 * B11 · Onkologi (rencana fase 8 §8.5, struktur dasar, tanpa mockup): siklus kemoterapi dengan dosis LPT, gerbang
 * lab, dan verifikasi ganda; ringkasan registri kanker. Layar klinis: banner pasien selalu tampil. Mode presentasi
 * (ADR-0023).
 */
export default async function OnkologiPage() {
  const { screen, allowed } = await requireDemoScreen('onkologi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { patient: p, plan, labs, verifiers } = await getOncology();

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Klinis / Onkologi · kemoterapi rawat jalan · B11 · data per ${formatJam(DEMO_NOW)}`}
        title="Onkologi · siklus kemoterapi"
      />
      <PatientBanner
        name={p.nama}
        sex={p.jk}
        ageYears={p.umur}
        birthDate={formatTanggalLahir(p.tanggalLahir)}
        mrn={p.rm}
        allergies={[...p.alergi]}
        guarantor={`${p.penjamin}${p.kelas ? ` ${p.kelas}` : ''}`}
        attending={plan.writer}
      />
      <Panel title="Registri kanker">
        <KeyValues
          rows={[
            ['Diagnosis', plan.diagnosis],
            ['Tanggal diagnosis', formatTanggal(plan.diagnosedAt)],
            [
              'Status registri',
              `${plan.registry.status} · diperbarui ${formatTanggal(plan.registry.updatedAt)}`,
            ],
          ]}
        />
      </Panel>
      <ChemoBoard plan={plan} labs={labs} verifiers={verifiers} />
    </div>
  );
}
