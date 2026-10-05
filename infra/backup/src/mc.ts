/**
 * Lokasi 2 (bucket cloud) dan 3 (offsite) lewat MinIO Client `mc`. Kredensial dipasang sebagai `MC_HOST_<alias>`
 * di lingkungan proses (bukan argumen). Mode Docker memasang folder lokal ke `/data` kontainer.
 */
import { MANIFEST_FILE } from './manifest';
import type { StoredRun } from './retention';
import type { S3Target } from './config';
import { dockerRunBase, hostForDocker, runChecked, type ToolMode } from './tools';

interface McLine {
  status?: string;
  key?: string;
  type?: string;
  error?: { message?: string };
}

export class Mc {
  constructor(
    private readonly mode: ToolMode,
    private readonly targets: readonly S3Target[],
    private readonly image: string,
  ) {}

  private hostEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const t of this.targets) {
      const u = new URL(t.endpoint);
      const host = this.mode === 'docker' ? hostForDocker(u.hostname) : u.hostname;
      const port = u.port ? `:${u.port}` : '';
      env[`MC_HOST_${t.alias}`] =
        `${u.protocol}//${encodeURIComponent(t.accessKey)}:${encodeURIComponent(t.secretKey)}@${host}${port}`;
    }
    return env;
  }

  private secrets(): string[] {
    return this.targets.flatMap((t) => [t.accessKey, t.secretKey]);
  }

  /** Jalankan `mc --json …`. `mount` = folder lokal yang dipakai argumen (`{dir}` diganti path yang sesuai). */
  private async exec(args: readonly string[], mount?: { dir: string; readOnly: boolean }): Promise<McLine[]> {
    const env = this.hostEnv();
    const local = mount?.dir ?? '';
    let cmd: string;
    let argv: string[];
    if (this.mode === 'docker') {
      const inner = args.map((a) => a.replaceAll('{dir}', '/data'));
      cmd = 'docker';
      argv = [
        ...dockerRunBase(),
        ...Object.keys(env).flatMap((k) => ['-e', k]),
        ...(mount ? ['-v', `${mount.dir}:/data${mount.readOnly ? ':ro' : ''}`] : []),
        this.image,
        '-C',
        '/tmp/.mc',
        '--json',
        ...inner,
      ];
    } else {
      cmd = 'mc';
      argv = ['--json', ...args.map((a) => a.replaceAll('{dir}', local))];
    }
    const r = await runChecked(cmd, argv, {
      env,
      secrets: this.secrets(),
      timeoutMs: 30 * 60_000,
      label: `mc ${args[0] ?? ''}`.trim(),
    });
    const lines = r.stdout
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l) as McLine);
    const failed = lines.find((l) => l.status === 'error');
    if (failed) throw new Error(`mc: ${failed.error?.message ?? 'galat'}`);
    return lines;
  }

  /** `alias/bucket/awalan/kunci` tanpa garis miring ganda atau di ujung (MinIO menolak nama objek berisi `//`). */
  private path(t: S3Target, ...parts: string[]): string {
    return [`${t.alias}/${t.bucket}`, ...parts]
      .join('/')
      .replace(/\/{2,}/g, '/')
      .replace(/\/+$/, '');
  }

  async ensureBucket(t: S3Target): Promise<void> {
    await this.exec(['mb', '--ignore-existing', this.path(t)]);
  }

  /** Unggah satu folder backup: semua berkas dulu, manifest terakhir (manifest ada = backup lengkap). */
  async uploadRun(localRunDir: string, t: S3Target, prefix: string, key: string): Promise<void> {
    const dest = this.path(t, prefix, key);
    await this.exec(['mirror', '--exclude', MANIFEST_FILE, '{dir}', dest], {
      dir: localRunDir,
      readOnly: true,
    });
    await this.exec(['cp', `{dir}/${MANIFEST_FILE}`, `${dest}/${MANIFEST_FILE}`], {
      dir: localRunDir,
      readOnly: true,
    });
  }

  /**
   * Salin seluruh awalan dari bucket utama ke offsite (inkremental, tanpa `--remove`: penghapusan di utama tidak
   * merambat). Dua tahap agar manifest selalu tiba setelah berkas datanya; run lama yang gagal tersalin ikut pulih.
   */
  async mirrorPrefix(from: S3Target, to: S3Target, prefix: string): Promise<void> {
    await this.exec([
      'mirror',
      '--exclude',
      `*/${MANIFEST_FILE}`,
      this.path(from, prefix),
      this.path(to, prefix),
    ]);
    await this.exec(['mirror', this.path(from, prefix), this.path(to, prefix)]);
  }

  /** Folder backup di bawah awalan, lengkap atau tidak (lengkap = ada manifest). */
  async listRuns(t: S3Target, prefix: string): Promise<StoredRun[]> {
    const lines = await this.exec(['ls', '--recursive', `${this.path(t, prefix)}/`]);
    const runs = new Map<string, boolean>();
    for (const l of lines) {
      if (l.type !== 'file' || !l.key) continue;
      const [run, file] = l.key.split('/');
      if (!run || !file) continue;
      runs.set(run, (runs.get(run) ?? false) || file === MANIFEST_FILE);
    }
    return [...runs].map(([key, complete]) => ({ key, complete }));
  }

  async removeRun(t: S3Target, prefix: string, key: string): Promise<void> {
    await this.exec(['rm', '--recursive', '--force', `${this.path(t, prefix, key)}/`]);
  }

  /** Hapus seluruh awalan (dipakai tes untuk membersihkan awalan uji). */
  async removePrefix(t: S3Target, prefix: string): Promise<void> {
    await this.exec(['rm', '--recursive', '--force', `${this.path(t, prefix)}/`]);
  }

  async removeBucket(t: S3Target): Promise<void> {
    await this.exec(['rb', '--force', this.path(t)]);
  }

  /** Unduh satu folder backup ke `destDir` (harus sudah ada dan kosong). */
  async downloadRun(t: S3Target, prefix: string, key: string, destDir: string): Promise<void> {
    await this.exec(['mirror', this.path(t, prefix, key), '{dir}'], { dir: destDir, readOnly: false });
  }
}
