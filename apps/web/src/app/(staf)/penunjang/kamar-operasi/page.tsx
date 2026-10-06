import { formatTanggal } from '@simrs/shared';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { readDomain } from '@/lib/server/demo/state';
import { getOrSchedule } from '@/lib/server/data/btn';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { OkClient } from './ok-client';

export const metadata: Metadata = { title: 'Kamar operasi' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * S06 · Kamar operasi: jadwal 4 kamar dan daftar tilik keselamatan WHO (mockup `OK.dc.html`). Mode presentasi:
 * data dummy fiktif; kasus Ny. Ratna Sari mengikuti skenario "Elektif · TPDI × BTN" (ADR-0023).
 */
export default async function KamarOperasiPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('ok');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const base = await getOrSchedule(session);
  const stored = await readDomain('penunjang');
  const { hook } = base;
  const data = {
    ...base.data,
    rooms: base.data.rooms.map((room) => ({
      ...room,
      cases: room.cases.map((c) =>
        c.scenario && hook ? c : (stored.state.operations.find((x) => x.id === c.id) ?? c),
      ),
    })),
  };
  const ids = data.rooms.flatMap((r) => r.cases.map((c) => c.id));
  const pick = typeof sp.pilih === 'string' && ids.includes(sp.pilih) ? sp.pilih : 'ok2-2';
  const stats = [
    { label: 'Utilisasi', value: `${data.stats.utilizationPercent}%` },
    { label: 'On-time start', value: `${data.stats.onTimeStartPercent}%` },
    { label: 'Pembatalan', value: String(data.stats.cancellations) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Instalasi bedah sentral · {session.tenant.name} · {formatTanggal(data.now)}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Kamar operasi · jadwal dan keselamatan</h1>
        </div>
        <dl className="m-0 flex flex-wrap gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-baseline gap-1.5 rounded-full border border-white/95 bg-white/90 px-3 py-1.5 text-small shadow-[0_2px_8px_rgba(23,32,46,0.06)]"
            >
              <dt className="text-ink-700">{s.label}</dt>
              <dd className="m-0 font-mono font-semibold">{s.value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <ScenarioBanner session={session} screen="ok" />
      <OkClient
        schedule={data}
        hook={hook}
        rev={stored.rev}
        stored={stored.state.ok}
        anesthesia={stored.state.anesthesia}
        consents={stored.state.consents}
        initialCaseId={pick}
        userName={session.user.displayName}
      />
    </div>
  );
}
