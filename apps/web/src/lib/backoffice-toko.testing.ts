import { type DemoActor, type DomainDef, project, type StoredEvent } from './demo/store/define';

/**
 * Alat tes domain toko back office (hanya dipakai `*.test.ts`): terapkan kejadian berurutan seperti toko (gerbang
 * `validate` dulu, lalu reducer), lempar pesan gerbang bila ditolak.
 */

export const actor = (userId: string, role: string, name = `Pengguna ${userId}`): DemoActor => ({
  userId,
  name,
  role,
  baseRole: null,
});

export function applyAll<S, E extends { type: string }>(
  def: DomainDef<S, E>,
  steps: ReadonlyArray<readonly [E, DemoActor]>,
  extra: readonly StoredEvent[] = [],
): S {
  const events: StoredEvent[] = [...extra];
  let seq = extra.reduce((n, e) => Math.max(n, e.seq), 0);
  for (const [data, who] of steps) {
    const state = project(def, { seq, resetSeq: 0, events }).state;
    const denied = def.validate?.(state, data, who);
    if (denied) throw new Error(denied);
    events.push({ seq: ++seq, domain: def.name, at: '2026-10-05T03:50:00.000Z', actor: who, data });
  }
  return project(def, { seq, resetSeq: 0, events }).state;
}

/** Pesan gerbang untuk kejadian berikutnya (null = diterima). */
export function denied<S, E extends { type: string }>(
  def: DomainDef<S, E>,
  state: S,
  event: E,
  who: DemoActor,
): string | null {
  return def.validate?.(state, event, who) ?? null;
}
