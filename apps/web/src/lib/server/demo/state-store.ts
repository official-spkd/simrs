import 'server-only';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DemoActor, project } from '../../demo/store/define';
import { appendEvent, emptyLog, type LogFile, parseLog, resetLog, serializeLog } from '../../demo/store/log';
import type { AnyDomainDef } from '../../demo/store/registry';

/**
 * Berkas toko demo bersama per ruang data (ADR-0085): `<DEMO_STATE_DIR>/toko/<RUANG>.json`, ruang = kode RS untuk
 * akun presentasi (satu keadaan per RS demo) atau kode RS + id pengguna untuk akun lain. Pola sama dengan toko
 * skenario (`store.ts`): perubahan diserialkan per ruang dalam satu proses web, ditulis atomik (berkas sementara lalu
 * rename), berkas hilang/rusak dianggap kosong. Hanya berisi log kejadian demo (data fiktif).
 */

/** Ruang data sebagai nama berkas (huruf, angka, tanda hubung; tidak bisa keluar dari folder). */
export function spaceFileKey(space: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,79}$/.test(space)) throw new Error('Ruang data demo tidak sah');
  return space.toUpperCase();
}

// Kunci per ruang data disimpan di globalThis: modul bisa termuat lebih dari sekali (bundel action vs halaman, HMR dev).
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

  private file(space: string) {
    return join(this.dir, 'toko', `${spaceFileKey(space)}.json`);
  }

  async load(space: string): Promise<LogFile> {
    const key = spaceFileKey(space);
    try {
      return parseLog(await readFile(this.file(key), 'utf8'), key);
    } catch {
      return emptyLog(key);
    }
  }

  /**
   * Ubah log ruang data secara berurutan. `fn` menerima log terkini dan mengembalikan log baru (atau null = tidak menulis).
   * Penulisan atomik: pembaca tidak pernah melihat berkas setengah jadi.
   */
  async update<T>(space: string, fn: (log: LogFile) => { next: LogFile | null; result: T }): Promise<T> {
    const key = spaceFileKey(space);
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
   * `validate` domain → reducer menerima → batas ukuran → tulis. Semua di dalam kunci ruang data, jadi gerbang yang dibaca
   * pemanggil sebelum kunci tetap sah (perubahan di antaranya membuat revisi berbeda).
   */
  async commit(
    space: string,
    def: AnyDomainDef,
    data: unknown,
    opts: { rev: number; actor: DemoActor; at: string },
  ): Promise<CommitResult> {
    const parsed = def.eventSchema.safeParse(data);
    if (!parsed.success) return { ok: false, error: 'Aksi tidak dikenal untuk data demo ini.' };
    return this.update<CommitResult>(space, (log) => {
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

  /** Mulai ulang data demo ruang ini: semua kejadian dihapus, semua domain kembali ke fixture awal. */
  async reset(space: string, actor: DemoActor, at: string): Promise<LogFile> {
    return this.update(space, (log) => {
      const next = resetLog(log, actor, at);
      return { next, result: next };
    });
  }
}
