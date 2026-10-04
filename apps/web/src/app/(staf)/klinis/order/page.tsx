import { Chip, Icon } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { patientByEncounterId } from '@/lib/demo/fixtures/pasien';
import { getCpoeEncounters } from '@/lib/server/data/klinis';
import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Order & resep (CPOE)' };

/** K09 · Pilih kunjungan hari ini untuk dibuka di CPOE (pasien skenario yang sedang dibawakan tampil teratas). */
export default async function CpoeIndexPage() {
  const { session, screen, allowed } = await requireDemoScreen('order');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const [encounters, runs] = await Promise.all([getCpoeEncounters(session), scenarioRuns(session)]);
  const active = new Set(scenariosHere(runs, 'order').map((h) => h.scenario));
  const isActive = (encounterId: string) => {
    const s = patientByEncounterId(encounterId)?.scenario;
    return Boolean(s && active.has(s));
  };
  const sorted = [...encounters].sort(
    (a, b) => Number(isActive(b.encounterId)) - Number(isActive(a.encounterId)),
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Order &amp; resep · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-semibold">Order &amp; resep (CPOE)</h1>
      </header>
      <ScenarioBanner session={session} screen="order" />
      <section
        aria-label="Kunjungan hari ini"
        className="overflow-hidden rounded-card border border-line bg-white shadow-card"
      >
        <h2 className="m-0 border-b border-line px-4 py-3 text-[15px] font-semibold">Kunjungan hari ini</h2>
        <ul className="m-0 list-none p-0">
          {sorted.map((e) => (
            <li key={e.encounterId} className="border-b border-line-soft last:border-b-0">
              <Link
                href={`/klinis/order/${e.encounterId}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-subtle"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold">{e.name}</span>
                  <span className="text-caption text-ink-500">
                    RM <span className="font-mono">{e.rm}</span> · {e.unit} · {e.note}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {isActive(e.encounterId) && <Chip tone="info">Langkah Simulasi aktif</Chip>}
                  {e.allergies.length > 0 ? (
                    <Chip tone="danger" icon={<Icon name="alert" size={13} strokeWidth={2} />}>
                      Alergi: {e.allergies.join(', ')}
                    </Chip>
                  ) : (
                    <Chip tone="neutral">Tidak ada alergi tercatat</Chip>
                  )}
                  <Icon name="chevronRight" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
