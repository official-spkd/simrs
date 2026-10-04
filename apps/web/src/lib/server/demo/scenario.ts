import 'server-only';
import { cache } from 'react';
import { advanceTo, applyAction, sanitizeSeq } from '../../demo/engine/run';
import type { ScenarioAction, ScenarioId } from '../../demo/engine/types';
import { PRESENTATION_USERNAME_PREFIX } from '../../demo/personas';
import { SCENARIO_DEF_VERSION, SCENARIOS } from '../../demo/skenario';
import type { SessionView } from '../../session-view';
import { assertDemo } from '../demo-guard';
import { type DemoRuns, demoKey, DemoStore, demoStateDir } from './store';

let store: DemoStore | undefined;
function demoStore(): DemoStore {
  store ??= new DemoStore(demoStateDir(), SCENARIO_DEF_VERSION);
  return store;
}

/** Bersihkan urutan tiap skenario dari kejadian yang tidak sah lagi (definisi berubah, berkas diubah tangan). */
function sanitized(runs: DemoRuns): DemoRuns {
  return {
    ...runs,
    runs: {
      'rawat-jalan': sanitizeSeq(SCENARIOS['rawat-jalan'], runs.runs['rawat-jalan']),
      'igd-ranap': sanitizeSeq(SCENARIOS['igd-ranap'], runs.runs['igd-ranap']),
      'elektif-btn': sanitizeSeq(SCENARIOS['elektif-btn'], runs.runs['elektif-btn']),
    },
  };
}

/**
 * Pemilik keadaan simulasi: akun presentasi (satu per posisi) berbagi satu keadaan per RS, sehingga presenter bisa
 * berganti akun tanpa kehilangan kemajuan skenario; akun lain (mis. akun uji) punya keadaan sendiri.
 */
const keyOf = (s: SessionView) =>
  demoKey(s.tenant.code, s.user.username.startsWith(PRESENTATION_USERNAME_PREFIX) ? 'presentasi' : s.user.id);

/** Keadaan simulasi akun demo ini (di-cache per render). */
export const loadDemoRuns = cache(async (session: SessionView): Promise<DemoRuns> => {
  assertDemo();
  return sanitized(await demoStore().load(keyOf(session)));
});

export type DemoCommand =
  /** Aksi pada skenario `scenario` (bawaan: skenario aktif); skenario itu sekaligus menjadi aktif. */
  | { type: 'scenario'; scenario?: ScenarioId; action: ScenarioAction }
  | { type: 'select'; scenario: ScenarioId }
  | { type: 'reset'; scenario: ScenarioId }
  | { type: 'jump'; scenario: ScenarioId; step: number };

export type DemoCommandResult =
  { ok: true; runs: DemoRuns } | { ok: false; error: string; task?: string; stale?: boolean };

/**
 * Jalankan satu perintah presenter. `rev` harus sama dengan keadaan terkini; selain itu ditolak sebagai basi
 * (tampilan dimuat ulang), sehingga dua tab tidak saling menimpa.
 */
export async function runDemoCommand(
  session: SessionView,
  rev: number,
  cmd: DemoCommand,
): Promise<DemoCommandResult> {
  assertDemo();
  return demoStore().update<DemoCommandResult>(keyOf(session), (raw) => {
    const current = sanitized(raw);
    if (rev !== current.rev) {
      return {
        next: null,
        result: {
          ok: false,
          stale: true,
          error: 'Simulasi sudah berubah di tab lain; tampilan dimuat ulang.',
        },
      };
    }
    const bump = (patch: Partial<DemoRuns>): DemoCommandResult & { ok: true } => ({
      ok: true,
      runs: { ...current, ...patch, rev: current.rev + 1 },
    });
    let result: DemoCommandResult;
    if (cmd.type === 'select') {
      result = bump({ active: cmd.scenario });
    } else if (cmd.type === 'reset') {
      result = bump({ active: cmd.scenario, runs: { ...current.runs, [cmd.scenario]: [] } });
    } else {
      const id = cmd.type === 'jump' ? cmd.scenario : (cmd.scenario ?? current.active);
      const def = SCENARIOS[id];
      const seq = current.runs[id];
      const r =
        cmd.type === 'jump'
          ? advanceTo(def, seq, Math.max(0, Math.min(cmd.step, def.steps.length - 1)))
          : applyAction(def, seq, cmd.action);
      result = r.ok
        ? bump({ active: id, runs: { ...current.runs, [id]: r.seq } })
        : { ok: false, error: r.error, task: r.task };
    }
    return { next: result.ok ? result.runs : null, result };
  });
}
