import { formatTanggal } from '@simrs/shared';
import { Alert, Chip } from '@simrs/ui';
import { notFound } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { PoliContext } from '@/components/klinis/poli-context';
import { PoliWorkspace } from '@/components/klinis/poli-workspace';
import { ScenarioBanner } from '@/components/scenario-banner';
import { screenById } from '@/lib/screens';
import { getPoliEncounter, getPoliWorklist } from '@/lib/server/data/klinis/poli';
import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import type { DemoScreenAccess } from '@/lib/server/demo-guard';

/**
 * K01/K02 · Pemeriksaan poli mode presentasi (mockup `Main.dc.html`, data dummy fiktif, ADR-0023). Jalur demo
 * dibekukan dan tetap diuji E2E demo (keputusan fase 2 #4); jalur api diisi layar W1 di `page.tsx`. Tn. Suryo
 * (skenario rawat jalan) masuk antrean setelah SEP terbit dan langkah asesmen perawat / pemeriksaan dokter dibawakan
 * lewat tombol asli layar ini. Kunjungan yang diminta (`?pasien=`) tetapi tidak ada di antrean hari ini → 404, bukan
 * diam-diam membuka rekam pasien lain (cegah salah pasien).
 */
export async function DemoPoli({ access, pasien }: { access: DemoScreenAccess; pasien: string | null }) {
  const { session, screen, allowed } = access;
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const requested = pasien || undefined;
  const [worklist, runs] = await Promise.all([getPoliWorklist(session), scenarioRuns(session)]);
  const here = scenariosHere(runs, 'poli');
  const scenarioItem = worklist.items.find((i) => i.scenario && here.some((h) => h.scenario === i.scenario));
  const fallback = scenarioItem ?? worklist.items.find((i) => i.status === 'diperiksa') ?? worklist.items[0];
  const selected = requested ? worklist.items.find((i) => i.patientId === requested) : fallback;
  const encounter = selected ? await getPoliEncounter(session, selected.patientId) : null;
  if (requested && !encounter) notFound();
  const h = selected?.scenario ? here.find((x) => x.scenario === selected.scenario) : undefined;
  const kasir = screenById('kasir');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Rawat jalan / {worklist.poli.name} / Pemeriksaan · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Pemeriksaan pasien</h1>
        </div>
        <span className="flex flex-wrap gap-2">
          <Chip tone="neutral">{formatTanggal(worklist.date)}</Chip>
          <Chip tone="brand">
            {worklist.poli.room} · {worklist.doctor}
          </Chip>
        </span>
      </header>
      <ScenarioBanner session={session} screen="poli" />
      {selected && encounter ? (
        <PoliWorkspace
          worklist={worklist}
          encounter={encounter}
          role={session.role?.code ?? null}
          binding={h ? { here: h, rev: runs.rev } : null}
          cpoeHref={`/klinis/order/${encounter.encounterId}`}
          kasirHref={kasir && kasir.status !== 'belum' ? kasir.route : null}
          aside={<PoliContext encounter={encounter} />}
        />
      ) : (
        <Alert level="info" title="Antrean kosong">
          Belum ada pasien di antrean {worklist.poli.name} hari ini.
        </Alert>
      )}
    </div>
  );
}
