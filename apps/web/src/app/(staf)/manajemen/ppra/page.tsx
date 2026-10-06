import { formatJam } from '@simrs/shared';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PpraBoard } from '@/components/ppra/ppra-board';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { appropriateRate, approvalHoursLeft } from '@/lib/ppra';
import { getAms } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { KpiTile } from '@/components/manajemen/kpi-tile';

export const metadata: Metadata = { title: 'PPRA' };

/**
 * B08 · Program pengendalian resistansi antimikroba (rencana fase 8 §8.5, tanpa mockup): persetujuan antibiotik
 * cadangan, audit Gyssens, katalog restriksi; modul dapat dimatikan per RS. Mode presentasi (ADR-0023), putusan
 * dan audit tersimpan di toko demo (domain `ppra`, ADR-0085).
 */
export default async function PpraPage() {
  const { session, screen, allowed } = await requireDemoScreen('ppra');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getAms();
  const st = d.store.state;
  const hours = d.requests
    .filter((r) => !st.decisions[r.id])
    .map((r) => approvalHoursLeft(r.requestedAt, DEMO_NOW));
  const waiting = hours.filter((h) => h >= 0);
  const urgent = waiting.filter((h) => h <= 4).length;
  const expired = hours.length - waiting.length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Pengendalian resistansi antimikroba · B08 · data per ${formatJam(DEMO_NOW)}`}
        title="Pengendalian resistansi antimikroba (PPRA)"
      />
      <div role="region" aria-label="Ringkasan PPRA" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiTile
          index={0}
          label="Menunggu persetujuan"
          value={String(waiting.length)}
          hint={urgent ? `${urgent} kedaluwarsa ≤ 4 jam` : 'semua > 4 jam'}
          detail="order antibiotik cadangan"
          tone={urgent ? 'danger' : 'warning'}
        />
        <KpiTile
          index={1}
          label="Kedaluwarsa tanpa putusan"
          value={String(expired)}
          hint="order dibatalkan otomatis"
          detail="batas 24 jam"
          tone={expired ? 'warning' : 'success'}
        />
        <KpiTile
          index={2}
          label="Penggunaan tepat (Gyssens 0)"
          value={`${appropriateRate(st.results)}%`}
          detail={`${st.results.length} kasus diaudit bulan ini`}
        />
        <KpiTile
          index={3}
          label="Antibiotik cadangan"
          value={String(d.restrictions.filter((r) => r.restriction === 'cadangan').length)}
          detail="wajib persetujuan tim PPRA"
        />
      </div>
      <PpraBoard
        requests={d.requests}
        restrictions={d.restrictions}
        pending={d.pending}
        state={st}
        rev={d.store.rev}
        viewer={{ name: session.user.displayName, role: session.role?.code ?? null }}
        now={DEMO_NOW}
      />
    </div>
  );
}
