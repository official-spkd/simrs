import { RmeChartHeader } from '@/components/rme/chart-header';
import { EdukasiWorkspace } from '@/components/rme/edukasi-workspace';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { consentIdOf } from '@/lib/demo/fixtures/pasien';
import { CONSENT_IDS } from '@/lib/demo/fixtures/rawat-inap';
import { DEFAULT_RECIPIENT, requiredTopics } from '@/lib/demo/fixtures/rme-edukasi';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { openRoute } from '@/lib/rme';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { eduRecordsOf, rmeChart } from '@/lib/server/data/klinis/rme';

const EDUCATORS = ['dokter', 'dokter_residen', 'perawat', 'bidan'];

/**
 * K11 · Edukasi pasien dan keluarga terintegrasi (`?pasien=`), melengkapi persetujuan tindakan di tablet. Mode
 * presentasi (ADR-0023): catatan rekam awal + toko demo `rekam-medis` (ADR-0085); backend lewat formulir P07
 * menyusul (rencana fase 3 · 3.7).
 */
export async function DemoEdukasi({
  access,
  pasien,
}: {
  access: DemoScreenAccess;
  pasien: string | string[] | undefined;
}) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { chart, state, rev } = await rmeChart(pasien);
  const p = chartPatient(chart);
  const role = session.role?.code ?? null;
  const consentRoute = openRoute('consent', role);
  const consentId = consentIdOf(p.id);
  const consentHref = consentRoute && CONSENT_IDS.includes(consentId) ? `${consentRoute}/${consentId}` : null;

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="edukasi"
        title="Edukasi pasien"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <EdukasiWorkspace
        key={chart.encounterId}
        encounterId={chart.encounterId}
        role={role}
        user={session.user.displayName}
        canEducate={!!role && EDUCATORS.includes(role)}
        required={requiredTopics(chart)}
        records={eduRecordsOf(chart.encounterId, state)}
        rev={rev}
        defaultRecipient={DEFAULT_RECIPIENT[chart.encounterId] ?? p.nama}
        consentHref={consentHref}
      />
    </div>
  );
}
