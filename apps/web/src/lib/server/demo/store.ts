import 'server-only';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { MAX_INPUT_LENGTH } from '../../demo/engine/run';
import type { ScenarioEvent, ScenarioId } from '../../demo/engine/types';
import { SCENARIO_ORDER } from '../../demo/skenario';

/**
 * Keadaan simulasi presentasi per akun demo (ADR-0023), disimpan di server (berkas JSON lokal), bukan cookie:
 * tiga skenario × puluhan kejadian melewati batas 4 KB cookie, dan tablet/TV yang masuk dengan akun demo yang
 * sama harus melihat keadaan yang sama. Hanya berisi urutan aksi presentasi (tanpa data pasien sungguhan).
 */

export interface DemoRuns {
  active: ScenarioId;
  runs: Record<ScenarioId, ScenarioEvent[]>;
  /** Revisi untuk menolak aksi dari tampilan basi (tab lain sudah memajukan simulasi). */
  rev: number;
}

const FILE_FORMAT = 1;

const eventSchema = z.union([
  z.strictObject({
    s: z.number().int().min(0).max(50),
    t: z.string().regex(/^[a-z0-9]{1,30}$/i),
    v: z.union([z.literal(true), z.string().max(MAX_INPUT_LENGTH)]),
  }),
  z.strictObject({ adv: z.number().int().min(1).max(51) }),
]);
const scenarioId = z.enum(SCENARIO_ORDER as [ScenarioId, ...ScenarioId[]]);
const fileSchema = z.strictObject({
  format: z.literal(FILE_FORMAT),
  defVersion: z.number().int(),
  active: scenarioId,
  runs: z.record(scenarioId, z.array(eventSchema).max(300)),
  rev: z.number().int().min(0),
});

export function emptyRuns(): DemoRuns {
  return {
    active: 'rawat-jalan',
    runs: { 'rawat-jalan': [], 'igd-ranap': [], 'elektif-btn': [] },
    rev: 0,
  };
}

/** Kunci berkas aman dari karakter path (kode RS + id pengguna). */
export function demoKey(tenantCode: string, userId: string): string {
  const clean = `${tenantCode}-${userId}`.replace(/[^A-Za-z0-9-]/g, '');
  if (clean.length < 10) throw new Error('Kunci keadaan demo tidak sah');
  return clean;
}

export class DemoStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dir: string,
    private readonly defVersion: number,
  ) {}

  private file(key: string) {
    return join(this.dir, `${key}.json`);
  }

  /** Keadaan tersimpan; berkas hilang, rusak, atau dari versi skenario lain dianggap kosong. */
  async load(key: string): Promise<DemoRuns> {
    let raw: string;
    try {
      raw = await readFile(this.file(key), 'utf8');
    } catch {
      return emptyRuns();
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return emptyRuns();
    }
    const parsed = fileSchema.safeParse(json);
    if (!parsed.success || parsed.data.defVersion !== this.defVersion) return emptyRuns();
    const base = emptyRuns();
    return {
      active: parsed.data.active,
      runs: { ...base.runs, ...parsed.data.runs },
      rev: parsed.data.rev,
    };
  }

  /**
   * Ubah keadaan secara berurutan per kunci (satu proses web). `fn` menerima keadaan terkini dan mengembalikan
   * keadaan baru, atau null untuk membatalkan. Penulisan atomik (berkas sementara lalu rename).
   */
  async update<T>(key: string, fn: (current: DemoRuns) => { next: DemoRuns | null; result: T }): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => gate);
    this.locks.set(key, chained);
    try {
      await prev;
      const current = await this.load(key);
      const { next, result } = fn(current);
      if (next) {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${this.file(key)}.${process.pid}.tmp`;
        const body = { format: FILE_FORMAT, defVersion: this.defVersion, ...next };
        await writeFile(tmp, JSON.stringify(body), 'utf8');
        await rename(tmp, this.file(key));
      }
      return result;
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }
}

/** Folder keadaan: `DEMO_STATE_DIR` atau `.local/demo-state` di root repo (diabaikan git). */
export function demoStateDir(env: Record<string, string | undefined> = process.env): string {
  return env.DEMO_STATE_DIR ? resolve(env.DEMO_STATE_DIR) : resolve(process.cwd(), '../../.local/demo-state');
}
