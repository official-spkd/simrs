import type { Metadata } from 'next';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { CpptWorkspace } from '@/components/rme/cppt-workspace';
import { HandoverPanel } from '@/components/rme/handover-panel';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import {
  CPPT_VERIFIED,
  draftSbar,
  HANDOVERS,
  NEXT_SHIFT_LABEL,
  NEXT_SHIFT_STAFF,
} from '@/lib/demo/fixtures/rme-cppt';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { canWriteCppt, cpptRoleOf, ewsLevel } from '@/lib/rawat-inap';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { rmeChartFor } from '@/lib/server/data/klinis/rme';

export const metadata: Metadata = { title: 'CPPT & serah terima' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * K07 · CPPT terintegrasi lintas PPA (`?pasien=<encounterId>`): co-sign residen, verifikasi DPJP ≤ 24 jam, koreksi
 * berversi, addendum, dan serah terima SBAR antarshift. Mode presentasi (ADR-0023); backend `POST /api/v1/cppt/…`
 * menyusul (rencana fase 3 · 3.2b).
 */
export default async function CpptPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('cppt');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const chart = rmeChartFor((await searchParams).pasien);
  const p = chartPatient(chart);
  const role = session.role?.code ?? null;
  const d = chart.inpatient;
  const entries = d?.cppt ?? [];
  const verified = Object.fromEntries(
    Object.entries(CPPT_VERIFIED).filter(([id]) => entries.some((e) => e.id === id)),
  );
  const last = [...entries].sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))[0];
  const primary = d?.summary.diagnoses.find((x) => x.primary);
  const lv = d ? ewsLevel(d.summary.lastEws, d.summary.lastEwsMaxParam) : null;
  const handoverOn = chart.setting !== 'rawat-jalan';

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="cppt"
        title="CPPT & serah terima"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <div className="flex flex-wrap items-start gap-4">
        <CpptWorkspace
          key={chart.encounterId}
          encounterId={chart.encounterId}
          initialEntries={entries}
          initialVerified={verified}
          user={session.user.displayName}
          role={role}
          dpjp={chart.dpjp}
          writerRole={cpptRoleOf(role)}
          canWrite={canWriteCppt(role)}
          now={DEMO_NOW}
        />
        {handoverOn ? (
          <HandoverPanel
            key={`${chart.encounterId}-serah-terima`}
            encounterId={chart.encounterId}
            user={session.user.displayName}
            shift={NEXT_SHIFT_LABEL}
            previous={HANDOVERS[chart.encounterId] ?? []}
            receivers={NEXT_SHIFT_STAFF}
            draft={draftSbar({
              lastAssessment: last ? `${last.a} (${last.author})` : 'Kondisi stabil.',
              background: `${p.riwayat}.${primary ? ` ${primary.code} ${primary.label}.` : ''}${p.alergi.length ? ` Alergi ${p.alergi.join(', ')}.` : ''}`,
              ews:
                lv && d
                  ? `EWS terakhir ${d.summary.lastEws} (${lv.level}). ${lv.action}`
                  : 'Observasi sesuai jadwal.',
              plan: d?.plan ?? '',
            })}
          />
        ) : (
          <p className="m-0 flex-[1_1_340px] rounded-card border border-line bg-white px-4 py-3.5 text-small text-ink-500">
            Serah terima SBAR antarshift berlaku untuk rawat inap dan kamar bersalin. Kunjungan rawat jalan
            ditutup dengan resume rawat jalan.
          </p>
        )}
      </div>
    </div>
  );
}
