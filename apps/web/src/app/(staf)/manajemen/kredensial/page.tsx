import { formatJam } from '@simrs/shared';
import { KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import { PageHead } from '@/components/backoffice/kit';
import { CredentialBoard } from '@/components/kredensial/credential-board';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { DEMO_NOW, DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { credentialVerifyBlock } from '@/lib/kredensial';
import { licenseStatus } from '@/lib/sdm';
import { getCredentialing } from '@/lib/server/data/backoffice';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Kredensial & kewenangan' };

/**
 * B04 · Kredensial dan kewenangan klinis (rencana fase 8 §8.3, tanpa mockup): pengajuan → verifikasi → telaah mitra
 * bestari → komite → RKK terbit, RKK berlaku, dan uji kait CPOE. Mode presentasi: data dummy (ADR-0023).
 */
export default async function KredensialPage() {
  const { screen, allowed } = await requireDemoScreen('kredensial');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getCredentialing();
  const byName = new Map(d.employees.map((e) => [e.name, e]));
  const blocked = d.applications.filter(
    (a) =>
      a.stage === 0 &&
      credentialVerifyBlock(byName.get(a.practitioner)?.licenses ?? [], DEMO_TODAY, a.documents),
  ).length;
  const expiring = d.granted.filter((g) => licenseStatus(g.expiry, DEMO_TODAY).status === 'segera');
  const noPrivilege = d.guardEvents.filter((e) => e.code === 'PRIVILEGE_REQUIRED').length;
  const practitioners = new Set(d.granted.map((g) => g.practitioner)).size;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        crumb={`Back office / Kredensial dan kewenangan klinis · B04 · data per ${formatJam(DEMO_NOW)}`}
        title="Kredensial dan kewenangan klinis"
      />
      <div
        role="region"
        aria-label="Ringkasan kredensial"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Pengajuan berjalan"
          value={String(d.applications.length)}
          hint={blocked ? `${blocked} tertahan di verifikasi berkas` : 'semua berjalan'}
          detail="komite medik dan keperawatan"
          tone={blocked ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="RKK berakhir ≤ 60 hari"
          value={String(expiring.length)}
          hint={expiring.length ? 'rekredensial perlu diputus sebelum berakhir' : 'tidak ada'}
          detail="butir kewenangan"
          tone={expiring.length ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="Praktisi ber-RKK"
          value={String(practitioners)}
          detail={`${d.granted.length} butir kewenangan berlaku`}
        />
        <KpiCard
          label="Order ditahan CPOE bulan ini"
          value={String(d.guardEvents.length)}
          hint={`${noPrivilege} tanpa kewenangan · ${d.guardEvents.length - noPrivilege} SIP kedaluwarsa`}
          detail="ditinjau komite medik"
          tone={d.guardEvents.length ? 'warning' : 'success'}
          tinted
        />
      </div>
      <CredentialBoard
        applications={d.applications}
        employees={d.employees}
        initialGranted={d.granted}
        today={DEMO_TODAY}
      />
    </div>
  );
}
