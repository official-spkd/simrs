import { formatJam, wallClockSchema } from '@simrs/shared';
import { z } from 'zod';
import type { DemoActor } from './demo/store/define';
import { demoNow } from './demo/fixtures/waktu';

/**
 * Bagian bersama domain toko demo back office + manajemen (CX-3, ADR-0085): skema jam tampilan, cap waktu demo,
 * pelaku tersimpan, dan pemisahan tugas berbasis ID pengguna sesi (bukan nama dari dropdown).
 *
 * Jam di kejadian (`jam`, `when`) adalah jam hari presentasi yang tampil di layar (`demoNow()`), hanya untuk
 * tampilan; gerbang tidak pernah memakainya. Pelaku selalu `ev.actor` dari sesi server.
 */

export const jamSchema = wallClockSchema;
/** Cap waktu demo penuh (ISO 8601 berzona), untuk tampilan "Sen, 5 Okt 2026 · 10.52". */
export const whenSchema = z.iso.datetime({ offset: true });
export const idSchema = z.string().min(1).max(80);
export const reasonSchema = z.string().trim().min(1).max(500);

/** Pelaku yang disimpan di keadaan domain (dari `ev.actor`). */
export interface ActorRef {
  userId: string;
  name: string;
  role: string | null;
}

export const actorRef = (a: DemoActor): ActorRef => ({ userId: a.userId, name: a.name, role: a.role });

/** Jam demo sekarang untuk kejadian (dipanggil di penangan aksi klien, bukan saat render). */
export function demoStamp(): { jam: string; when: string } {
  const now = demoNow();
  return { jam: formatJam(now), when: now.toISOString() };
}

/** Pemisahan tugas: pelaku kedua harus pengguna lain (ID sesi), termasuk Superadmin demo yang berganti posisi. */
export function sameUserBlock(
  first: ActorRef | null | undefined,
  second: DemoActor,
  message: string,
): string | null {
  return first && first.userId === second.userId ? message : null;
}

/** Hanya posisi tertentu (posisi yang dibawakan saat aksi; Superadmin demo: hasil "Bertindak sebagai"). */
export function roleBlock(actor: DemoActor, roles: readonly string[], message: string): string | null {
  return actor.role && roles.includes(actor.role) ? null : message;
}

/** Entri riwayat singkat (terbaru di atas), dibatasi agar keadaan tetap kecil. */
export interface LogLine {
  jam: string;
  text: string;
  by: string;
}

export function pushLog(log: readonly LogLine[], line: LogLine, max = 30): LogLine[] {
  return [line, ...log].slice(0, max);
}

/** Lempar galat gerbang di reducer (kejadian tidak sah dilewati saat diputar ulang). */
export function must(block: string | null): void {
  if (block) throw new Error(block);
}
