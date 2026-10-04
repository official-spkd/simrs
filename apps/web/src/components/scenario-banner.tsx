import { scenarioRuns, scenariosHere } from '@/lib/server/demo/scenario-context';
import { webEnv } from '@/lib/server/web-env';
import type { SessionView } from '@/lib/session-view';
import { ScenarioStepPanel } from './scenario-step-panel';

/**
 * Banner tugas skenario di layar asli (mode presentasi, ADR-0023): bila langkah aktif sebuah skenario dibawakan di
 * layar ini, tampilkan tugasnya (dengan gerbang yang sama seperti layar Simulasi) agar presenter bisa memajukan
 * cerita tanpa pindah layar. Di luar mode presentasi tidak merender apa pun.
 */
export async function ScenarioBanner({ session, screen }: { session: SessionView; screen: string }) {
  if (webEnv().dataSource !== 'demo') return null;
  const runs = await scenarioRuns(session);
  const here = scenariosHere(runs, screen);
  if (here.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {here.map((h) => (
        <ScenarioStepPanel key={h.scenario} here={h} rev={runs.rev} />
      ))}
    </div>
  );
}
