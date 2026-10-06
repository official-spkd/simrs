import 'server-only';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DemoActor, project } from '../../demo/store/define';
import { appendEvent, emptyLog, type LogFile, parseLog, resetLog, serializeLog } from '../../demo/store/log';
import type { AnyDomainDef } from '../../demo/store/registry';

/**
 * Berkas toko demo bersama per RS (ADR-0085): `<DEMO_STATE_DIR>/toko/<KODE-RS>.json`. Pola sama dengan toko skenario
 * (`store.ts`): perubahan diserialkan per RS dalam satu proses web, ditulis atomik (berkas sementara lalu rename),
 * berkas hilang/rusak dianggap kosong. Hanya berisi log kejadian demo (data fiktif).
 */

/** Kode RS sebagai nama berkas (huruf, angka, tanda hubung). */
export function tenantFileKey(code: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,29}$/.test(code)) throw new Error('Kode RS toko demo tidak sah');
  return code.toUpperCase();
}

// Kunci per RS disimpan di globalThis: modul bisa termuat lebih dari sekali (bundel action vs halaman, HMR dev).
const LOCKS_KEY = Symbol.for('simrs.demo-state-store.locks');
type LockMap = Map<string, Promise<unknown>>;
function locks(): LockMap {
  const g = globalThis as { [LOCKS_KEY]?: LockMap };
  g[LOCKS_KEY] ??= new Map();
  return g[LOCKS_KEY];
}

export type CommitResult =
  { ok: true; rev: number; seq: number } | { ok: false; error: string; stale?: true; full?: true };

export const STALE_MESSAGE = 'Data demo sudah berubah di tab atau perangkat lain; tampilan dimuat ulang.';

export class DemoStateStore {
  constructor(private readonly dir: string) {}

  private file(tenant: string) {
    return join(this.dir, 'toko', `${tenantFileKey(tenant)}.json`);
  }

  async load(tenant: string): Promise<LogFile> {
    const key = tenantFileKey(tenant);
    try {
      return parseLog(await readFile(this.file(key), 'utf8'), key);
    } catch {
      return emptyLog(key);
    }
  }

  /**
   * Ubah log RS secara berurutan. `fn` menerima log terkini dan mengembalikan log baru (atau null = tidak menulis).
   * Penulisan atomik: pembaca tidak pernah melihat berkas setengah jadi.
   */
  async update<T>(tenant: string, fn: (log: LogFile) => { next: LogFile | null; result: T }): Promise<T> {
    const key = tenantFileKey(tenant);
    const map = locks();
    const lockKey = `${this.dir}\u0000${key}`;
    const prev = map.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => gate);
    map.set(lockKey, chained);
    try {
      await prev;
      const { next, result } = fn(await this.load(key));
      if (next) {
        const file = this.file(key);
        await mkdir(join(this.dir, 'toko'), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        try {
          await writeFile(tmp, serializeLog(next), 'utf8');
          await rename(tmp, file);
        } catch (err) {
          await rm(tmp, { force: true });
          throw err;
        }
      }
      return result;
    } finally {
      release();
      if (map.get(lockKey) === chained) map.delete(lockKey);
    }
  }

  /**
   * Catat satu kejadian domain bila revisi yang dilihat pemanggil masih terkini. Urutan: skema → revisi (basi?) →
   * `validate` domain → reducer menerima → batas ukuran → tulis. Semua di dalam kunci RS, jadi gerbang yang dibaca
   * pemanggil sebelum kunci tetap sah (perubahan di antaranya membuat revisi berbeda).
   */
  async commit(
    tenant: string,
    def: AnyDomainDef,
    data: unknown,
    opts: { rev: number; actor: DemoActor; at: string },
  ): Promise<CommitResult> {
    const parsed = def.eventSchema.safeParse(data);
    if (!parsed.success) return { ok: false, error: 'Aksi tidak dikenal untuk data demo ini.' };
    return this.update<CommitResult>(tenant, (log) => {
      const current = project(def, log);
      if (opts.rev !== current.rev)
        return { next: null, result: { ok: false, error: STALE_MESSAGE, stale: true } };
      const denied = def.validate?.(current.state, parsed.data, opts.actor);
      if (denied) return { next: null, result: { ok: false, error: denied } };
      const r = appendEvent(log, def.name, parsed.data, opts.actor, opts.at);
      if (!r.ok) return { next: null, result: r.full ? { ok: false, error: r.error, full: true } : r };
      try {
        def.reduce(current.state, { ...r.event, data: parsed.data });
      } catch (err) {
        return { next: null, result: { ok: false, error: err instanceof Error ? err.message : String(err) } };
      }
      return { next: r.log, result: { ok: true, rev: r.event.seq, seq: r.event.seq } };
    });
  }

  /** Mulai ulang data demo RS: semua kejadian dihapus, semua domain kembali ke fixture awal. */
  async reset(tenant: string, actor: DemoActor, at: string): Promise<LogFile> {
    return this.update(tenant, (log) => {
      const next = resetLog(log, actor, at);
      return { next, result: next };
    });
  }
}
