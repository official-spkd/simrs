import { IncomingOrders } from '@/components/penunjang/incoming-orders';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { LabWorkspace } from '@/components/penunjang/lab-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { getLabWorklist } from '@/lib/server/data/penunjang/lab';
import { penunjangScenario } from '@/lib/server/data/penunjang/shared';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';
import { readDomain } from '@/lib/server/demo/state';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S01/S09 · Laboratorium: worklist, hasil dengan LOINC, flag dan delta check, nilai kritis dengan timer dan
 * read-back, validasi teknis lalu klinis (mockup `Lab.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023); dibekukan, jalur api di `page.tsx`.
 */
export async function DemoLab({
  access,
  searchParams,
}: {
  access: DemoScreenAccess;
  searchParams: SearchParams;
}) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const { results, hook } = await penunjangScenario(session, 'lab');
  const data = await getLabWorklist(results);
  // Laporan nilai kritis tersimpan (toko demo, ADR-0085): revisi untuk aksi + id yang dilaporkan.
  const critical = await readDomain('hasil-kritis');
  const pilih = typeof sp.pilih === 'string' ? sp.pilih : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Laboratorium / Worklist · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Laboratorium · validasi hasil</h1>
        </div>
        <ul aria-label="Koneksi analyzer" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {data.analyzers.map((a) => (
            <li
              key={a.name}
              className={
                a.online
                  ? 'rounded-full bg-zamrud-100 px-2.5 py-1.5 text-small font-semibold text-zamrud-700'
                  : 'rounded-full bg-koral-100 px-2.5 py-1.5 text-small font-semibold text-koral-800'
              }
            >
              <span aria-hidden="true">● </span>
              {a.name} {a.online ? 'terhubung' : 'terputus'} ({a.link})
            </li>
          ))}
        </ul>
      </header>
      <ScenarioBanner session={session} screen="lab" />
      <IncomingOrders orders={data.incoming} destination="lab" />
      <LabWorkspace
        role={session.role?.code ?? null}
        data={data}
        hook={hook}
        initialSelected={pilih}
        userName={session.user.displayName}
        criticalRev={critical.rev}
        storedCritical={Object.keys(critical.state.reports)}
      />
    </div>
  );
}
