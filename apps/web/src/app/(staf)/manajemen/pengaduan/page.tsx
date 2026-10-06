import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ExperienceBoard } from '@/components/pengalaman/experience-board';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { needsFollowUp, responseRate, satisfactionIndex, slaState } from '@/lib/pengalaman';
import { getPatientExperience } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { complaintRecords } from '@/lib/pengaduan-toko';

export const metadata: Metadata = { title: 'Pengalaman pasien' };

/**
 * B13 · Pengalaman pasien (rencana fase 8 §8.7, tanpa mockup): pengaduan ber-SLA dan survei kepuasan. Nilai INM-12
 * dan INM-13 dihitung dari data yang sama dengan layar Mutu. Mode presentasi: data dummy (ADR-0023), aksi tersimpan
 * di toko demo (domain `pengaduan`, ADR-0085).
 */
export default async function PengaduanPage() {
  const { screen, allowed } = await requireDemoScreen('pengaduan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getPatientExperience();
  const st = d.store.state;
  const open = st.complaints.filter((c) => c.stageNow < 4);
  const rate = responseRate(complaintRecords(st), DEMO_NOW);
  const late = open.filter(
    (c) => c.grade && slaState(c.receivedAt, c.grade, DEMO_NOW, c.answeredAt).state === 'lewat',
  ).length;
  const ungraded = open.filter((c) => !c.grade).length;
  const low = d.responses.filter(needsFollowUp).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Pengalaman pasien · B13 · data per ${formatJam(DEMO_NOW)}`}
        title="Pengalaman pasien"
      />
      <div
        role="region"
        aria-label="Ringkasan pengalaman pasien"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Pengaduan terbuka"
          value={String(open.length)}
          hint={late ? `${late} lewat SLA` : 'semua dalam SLA'}
          detail={`${ungraded} belum digrading`}
          tone={late ? 'danger' : 'warning'}
          tinted
        />
        <KpiCard
          label="Tanggap komplain (INM-12)"
          value={`${rate.pct}%`}
          hint={(rate.pct ?? 0) >= 80 ? 'memenuhi sasaran ≥ 80%' : 'di bawah sasaran ≥ 80%'}
          detail={`${rate.within}/${rate.total} dijawab dalam SLA · 30 hari`}
          tone={(rate.pct ?? 0) >= 80 ? 'success' : 'danger'}
          tinted
        />
        <KpiCard
          label="Kepuasan pasien (INM-13)"
          value={String(satisfactionIndex(d.responses))}
          hint="indeks 0–100 · sasaran ≥ 80"
          detail={`${d.responses.length} respons survei pasca-pulang`}
          tone="success"
          tinted
        />
        <KpiCard
          label="Skor rendah"
          value={String(low)}
          hint="perlu ditindaklanjuti"
          detail="aspek bernilai ≤ 2 dari 4"
          tone={low ? 'warning' : 'success'}
          tinted
        />
      </div>
      <ExperienceBoard store={st} rev={d.store.rev} responses={d.responses} now={DEMO_NOW} />
    </div>
  );
}
