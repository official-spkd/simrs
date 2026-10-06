import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { HrBoard } from '@/components/sdm/hr-board';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { publishBlock, restViolations, rosterGaps, worstLicense } from '@/lib/sdm';
import { getHr } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'SDM & kepegawaian' };

/**
 * B03 · SDM dan kepegawaian (rencana fase 8 §8.2, tanpa mockup): pegawai + STR/SIP, offboarding, jadwal dinas per
 * unit. Mode presentasi: data dummy fiktif (ADR-0023).
 */
export default async function SdmPage() {
  const { screen, allowed } = await requireDemoScreen('sdm');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getHr();
  const st = d.employees.map((e) => worstLicense(e.licenses, DEMO_TODAY).status);
  const expired = st.filter((s) => s === 'kedaluwarsa').length;
  const soon = st.filter((s) => s === 'segera').length;
  const gaps = rosterGaps(d.draft, d.roster.dayLabels.length, d.roster.minimum);
  const block = publishBlock(gaps, restViolations(d.draft, d.roster.dayLabels.length));

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / SDM dan kepegawaian · B03 · data per ${formatJam(DEMO_NOW)}`}
        title="SDM dan kepegawaian"
      />
      <div role="region" aria-label="Ringkasan SDM" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Pegawai aktif"
          value={String(d.employees.length)}
          detail="data contoh · 6 kelompok tenaga"
        />
        <KpiCard
          label="Izin praktik kedaluwarsa"
          value={String(expired)}
          hint={expired ? 'order klinis diblokir di CPOE' : 'tidak ada'}
          detail="STR/SIP dicek tiap pagi"
          tone={expired ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Berakhir ≤ 60 hari"
          value={String(soon)}
          hint="pengingat perpanjangan"
          detail="diingatkan 60 hari sebelum berakhir"
          tone={soon ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label={`Jadwal ${d.roster.unit} minggu depan`}
          value="Draf"
          hint={block ?? 'siap terbit'}
          detail={d.roster.weekLabel}
          tone={block ? 'warning' : 'success'}
          tinted
        />
      </div>
      <HrBoard data={d} today={DEMO_TODAY} alerts={expired + soon} />
    </div>
  );
}
