import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHead } from '@/components/backoffice/kit';
import { CommandBoard } from '@/components/command-center/command-board';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { boarding, decisionAlerts, wardRows } from '@/lib/command-center';
import { getCommandCenter } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Command center' };

/**
 * I09 · Command center (melengkapi Dasbor direksi, tanpa mockup): kapasitas bed real-time, IGD, antrean, alert
 * keputusan. Data dibaca dari toko demo layar asalnya (Tempat tidur, IGD, papan antrean), mode presentasi
 * (ADR-0023/0085); keputusan alert tersimpan (domain `command-center`).
 */
export default async function CommandCenterPage() {
  const { session, screen, allowed } = await requireDemoScreen('command-center');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getCommandCenter(session);
  const rows = wardRows(d.wards, d.state.beds);
  const occ = rows.reduce((n, r) => n + r.occupied, 0);
  const all = rows.reduce((n, r) => n + r.total, 0);
  const ready = rows.reduce((n, r) => n + r.ready, 0);
  const waiting = boarding(d.state.ed);
  const alerts = decisionAlerts(d.state, d.wards);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Manajemen / Command center · I09 · data per ${formatJam(d.asOf)}`}
        title="Command center"
        actions={
          <Link href="/manajemen/dasbor" className="text-small font-medium text-brand-700">
            Dasbor direksi (tren dan keuangan)
          </Link>
        }
      />
      <div
        role="region"
        aria-label="Ringkasan command center"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Tempat tidur terisi"
          value={`${Math.round((occ / all) * 100)}%`}
          detail={`${occ}/${all} · ${ready} siap`}
        />
        <KpiCard
          label="IGD menunggu bed"
          value={String(waiting.length)}
          hint={waiting[0] ? `terlama ${waiting[0].losMinutes} menit` : 'tidak ada'}
          detail={`${d.state.ed.length} pasien di IGD`}
          tone={waiting.length ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Antrean poli"
          value={String(d.state.queues.reduce((n, q) => n + q.waiting, 0))}
          detail={`loket + ${d.state.queues.length - 1} poli lantai 2`}
        />
        <KpiCard
          label="Alert keputusan"
          value={String(alerts.length)}
          hint={`${alerts.filter((a) => a.level === 'critical').length} kritis`}
          detail="wajib ditindaklanjuti"
          tone={alerts.length ? 'warning' : 'success'}
          tinted
        />
      </div>
      <CommandBoard
        asOf={d.asOf}
        wards={d.wards}
        state={d.state}
        acks={d.store.state.acks}
        rev={d.store.rev}
        viewerRole={session.role?.code ?? null}
      />
    </div>
  );
}
