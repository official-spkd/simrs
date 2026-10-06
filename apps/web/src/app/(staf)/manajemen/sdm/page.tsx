import { formatJam } from '@simrs/shared';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { HrBoard } from '@/components/sdm/hr-board';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { worstLicense } from '@/lib/sdm';
import { rosterPublishBlock } from '@/lib/sdm-toko';
import { getHr } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { KpiTile } from '@/components/manajemen/kpi-tile';

export const metadata: Metadata = { title: 'SDM & kepegawaian' };

/**
 * B03 · SDM dan kepegawaian (rencana fase 8 §8.2, tanpa mockup): pegawai + STR/SIP, offboarding, jadwal dinas per
 * unit. Mode presentasi: data dummy fiktif (ADR-0023), aksi tersimpan di toko demo (domain `sdm`, ADR-0085).
 */
export default async function SdmPage() {
  const { screen, allowed } = await requireDemoScreen('sdm');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getHr();
  const hr = d.store.state;
  const st = d.employees
    .filter((e) => !hr.employees[e.id]?.left)
    .map((e) => worstLicense(hr.employees[e.id]?.licenses ?? e.licenses, DEMO_TODAY).status);
  const expired = st.filter((s) => s === 'kedaluwarsa').length;
  const soon = st.filter((s) => s === 'segera').length;
  const block = hr.published ? null : rosterPublishBlock(hr.roster);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / SDM dan kepegawaian · B03 · data per ${formatJam(DEMO_NOW)}`}
        title="SDM dan kepegawaian"
      />
      <div role="region" aria-label="Ringkasan SDM" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiTile
          index={0}
          label="Pegawai aktif"
          value={String(d.employees.filter((e) => !hr.employees[e.id]?.left).length)}
          detail="data contoh · 6 kelompok tenaga"
        />
        <KpiTile
          index={1}
          label="Izin praktik kedaluwarsa"
          value={String(expired)}
          hint={expired ? 'order klinis diblokir di CPOE' : 'tidak ada'}
          detail="STR/SIP dicek tiap pagi"
          tone={expired ? 'danger' : 'success'}
        />
        <KpiTile
          index={2}
          label="Berakhir ≤ 60 hari"
          value={String(soon)}
          hint="pengingat perpanjangan"
          detail="diingatkan 60 hari sebelum berakhir"
          tone={soon ? 'warning' : 'success'}
        />
        <KpiTile
          index={3}
          label={`Jadwal ${d.roster.unit} minggu depan`}
          value={hr.published ? `Terbit v${hr.published.version}` : `Draf v${hr.version}`}
          hint={block ?? 'siap terbit'}
          detail={d.roster.weekLabel}
          tone={block ? 'warning' : 'success'}
        />
      </div>
      <HrBoard data={d} today={DEMO_TODAY} alerts={expired + soon} />
    </div>
  );
}
