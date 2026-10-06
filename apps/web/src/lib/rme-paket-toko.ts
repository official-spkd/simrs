import { type CarePackage, type GateDecision, setTodayStatus } from './rme-paket';
import type { PaketChanges } from './rme-toko-bagan';

/**
 * K15 · Paket layanan dari toko demo `rekam-medis` (ADR-0085): butir kelengkapan selesai, keputusan gerbang lab
 * (tunda / override beralasan), dan status sesi hari ini diterapkan ke paket fixture. Logika murni.
 */

export interface PaketView {
  pkg: CarePackage;
  decision: GateDecision;
  /** Gerbang sudah diputuskan: teks keputusan (ikuti/override) untuk kotak gerbang keselamatan. */
  gate: { kind: 'ikuti' | 'override'; text: string } | null;
}

export function applyPaket(
  pkg: CarePackage,
  c: PaketChanges | undefined,
  jam: (iso: string) => string,
): PaketView {
  if (!c) return { pkg, decision: null, gate: null };
  let sessions = pkg.sessions;
  if (c.decision?.kind === 'tunda') sessions = setTodayStatus(sessions, 'ditunda', c.decision.note);
  if (c.session) sessions = setTodayStatus(sessions, c.session.to, c.session.note);
  const items = pkg.items.map((it) =>
    it.done || !c.items[it.id] ? it : { ...it, done: c.items[it.id] ?? null },
  );
  const d = c.decision;
  return {
    pkg: { ...pkg, items, sessions },
    decision:
      d?.kind === 'override' && d.reason ? { kind: 'override', reason: d.reason, by: d.by, at: d.at } : null,
    gate: d
      ? d.kind === 'tunda'
        ? { kind: 'ikuti', text: `Sesi ditunda · ${jam(d.at)}` }
        : { kind: 'override', text: `${d.reason ?? ''} · ${d.by} · ${jam(d.at)}` }
      : null,
  };
}
