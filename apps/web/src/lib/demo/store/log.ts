import { z } from 'zod';
import { type DemoActor, DOMAIN_NAME, type LogView, type StoredEvent } from './define';

/**
 * Format berkas toko demo per RS (ADR-0085) dan operasi murninya: tambah kejadian dengan batas ukuran, mulai ulang.
 * I/O (baca, tulis atomik, kunci) ada di `lib/server/demo/state-store.ts`.
 */

export const LOG_FORMAT = 1;

/** Batas toko per RS demo: presentasi sehari tidak mendekatinya; tujuannya mencegah berkas tumbuh tanpa batas. */
export const LOG_LIMITS = {
  /** Jumlah kejadian per RS. */
  maxEvents: 5_000,
  /** Ukuran `data` satu kejadian (byte JSON). */
  maxEventBytes: 16_384,
  /** Ukuran berkas (byte JSON). */
  maxFileBytes: 4_000_000,
} as const;

const actorSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  name: z.string().max(120),
  role: z.string().max(60).nullable(),
  baseRole: z.string().max(60).nullable(),
});

const eventSchema = z.strictObject({
  seq: z.number().int().positive(),
  domain: z.string().regex(DOMAIN_NAME),
  at: z.iso.datetime({ offset: true }),
  actor: actorSchema,
  data: z.unknown(),
});

const lastResetSchema = z.strictObject({ at: z.iso.datetime({ offset: true }), actor: actorSchema });

export const logFileSchema = z.strictObject({
  format: z.literal(LOG_FORMAT),
  tenant: z.string().min(2).max(30),
  seq: z.number().int().min(0),
  resetSeq: z.number().int().min(0),
  lastReset: lastResetSchema.nullable(),
  events: z.array(eventSchema).max(LOG_LIMITS.maxEvents),
});

export interface LogFile extends LogView {
  format: typeof LOG_FORMAT;
  tenant: string;
  lastReset: { at: string; actor: DemoActor } | null;
  events: StoredEvent[];
}

export function emptyLog(tenant: string): LogFile {
  return { format: LOG_FORMAT, tenant, seq: 0, resetSeq: 0, lastReset: null, events: [] };
}

/**
 * Baca isi berkas. Berkas rusak, format lain, atau milik RS lain dianggap kosong; kejadian yang `seq`-nya tidak naik
 * berurutan dibuang (berkas diubah tangan), sehingga revisi tetap monoton.
 */
export function parseLog(raw: string, tenant: string): LogFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyLog(tenant);
  }
  const p = logFileSchema.safeParse(json);
  if (!p.success || p.data.tenant !== tenant) return emptyLog(tenant);
  const events: StoredEvent[] = [];
  let last = p.data.resetSeq;
  for (const ev of p.data.events) {
    if (ev.seq <= last || ev.seq > p.data.seq) continue;
    events.push(ev);
    last = ev.seq;
  }
  return { ...p.data, events };
}

export function serializeLog(log: LogFile): string {
  return JSON.stringify(log);
}

/** Ukuran UTF-8 (nama pasien/penerima bisa memuat huruf non-ASCII). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type AppendResult =
  { ok: true; log: LogFile; event: StoredEvent } | { ok: false; error: string; full?: true };

const FULL_MESSAGE =
  'Batas data demo RS ini tercapai. Minta admin RS, manajemen, atau Superadmin demo memilih "Mulai ulang data demo".';

/** Tambah satu kejadian (data sudah lolos skema domain) dengan pemeriksaan batas ukuran. Murni. */
export function appendEvent(
  log: LogFile,
  domain: string,
  data: unknown,
  actor: DemoActor,
  at: string,
): AppendResult {
  if (!DOMAIN_NAME.test(domain)) return { ok: false, error: 'Domain toko demo tidak dikenal.' };
  const body = JSON.stringify(data);
  if (body === undefined || byteLength(body) > LOG_LIMITS.maxEventBytes) {
    return { ok: false, error: 'Isi aksi terlalu besar untuk data demo.' };
  }
  if (log.events.length >= LOG_LIMITS.maxEvents) return { ok: false, error: FULL_MESSAGE, full: true };
  const event: StoredEvent = { seq: log.seq + 1, domain, at, actor, data };
  const next: LogFile = { ...log, seq: event.seq, events: [...log.events, event] };
  if (byteLength(serializeLog(next)) > LOG_LIMITS.maxFileBytes)
    return { ok: false, error: FULL_MESSAGE, full: true };
  return { ok: true, log: next, event };
}

/**
 * Mulai ulang: semua kejadian dihapus, keadaan kembali ke fixture awal. `seq` tetap naik (tidak kembali ke 0) agar
 * tampilan sebelum mulai ulang selalu dianggap basi.
 */
export function resetLog(log: LogFile, actor: DemoActor, at: string): LogFile {
  const seq = log.seq + 1;
  return { ...log, seq, resetSeq: seq, lastReset: { at, actor }, events: [] };
}
