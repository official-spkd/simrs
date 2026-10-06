import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { EducationBoard } from '@/components/pendidikan/education-board';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { getEducation } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Pendidikan klinik' };

/**
 * B10 · Pendidikan klinik (rencana fase 8 §8.5, struktur dasar, tanpa mockup): peserta didik, supervisi bertingkat
 * yang menentukan co-sign, logbook terverifikasi. Mode presentasi: data dummy (ADR-0023).
 */
export default async function PendidikanPage() {
  const { screen, allowed } = await requireDemoScreen('pendidikan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getEducation();
  const pending = d.logbook.filter((e) => e.status === 'menunggu').length;
  const cosign = d.trainees.reduce((n, t) => n + t.pendingCosign, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Pendidikan klinik · B10 · data per ${formatJam(DEMO_NOW)}`}
        title="Pendidikan klinik"
      />
      <div
        role="region"
        aria-label="Ringkasan pendidikan klinik"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Peserta didik aktif"
          value={String(d.trainees.length)}
          detail="residen, koas, mahasiswa profesi"
        />
        <KpiCard
          label="Logbook menunggu verifikasi"
          value={String(pending)}
          hint={pending ? 'supervisor diingatkan harian' : 'tidak ada'}
          detail="verifikasi oleh supervisor"
          tone={pending ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="Menunggu co-sign"
          value={String(cosign)}
          hint="CPPT dan order peserta didik"
          detail="dirutekan ke supervisor"
          tone={cosign ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="Supervisor"
          value={String(new Set(d.trainees.map((t) => t.supervisor)).size)}
          detail="DPJP dan perawat pembimbing"
        />
      </div>
      <EducationBoard trainees={d.trainees} logbook={d.logbook} />
    </div>
  );
}
