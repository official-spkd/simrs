/**
 * Menjalankan alat eksternal tanpa shell (argumen tidak pernah diinterpretasi ulang). pg_dump dan mc memakai biner
 * lokal bila tersedia dan cocok, selain itu image Docker resmi (`postgres:16-alpine`, `pgsty/mc`) — host ops tidak
 * perlu memasang apa pun selain Node + Docker. Rahasia hanya lewat variabel lingkungan proses anak, tidak di argv.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { getgid, getuid } from 'node:process';

export class ToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = 'ToolError';
  }
}

export interface RunOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Rahasia yang wajib disamarkan bila muncul di stderr/stdout yang dilaporkan. */
  secrets?: readonly string[];
  timeoutMs?: number;
  /** Nama alat di pesan galat (bawaan: nama perintah). */
  label?: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_CAPTURE = 4 * 1024 * 1024;

/** Samarkan kredensial di teks keluaran alat: `//user:pass@` dan nilai rahasia eksplisit. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***:***@');
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('***');
  return out;
}

export function run(cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += d.toString();
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs).unref()
      : undefined;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new ToolError(
          cmd,
          (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'tidak ditemukan di PATH' : err.message,
        ),
      );
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** `run` yang melempar bila kode keluar ≠ 0, dengan ekor stderr yang sudah disamarkan. */
export async function runChecked(
  cmd: string,
  args: readonly string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    const tail = redact((r.stderr || r.stdout).trim().split('\n').slice(-5).join(' | '), opts.secrets);
    throw new ToolError(
      opts.label ?? (cmd === 'docker' ? `docker ${args[0] ?? ''}`.trim() : cmd),
      `keluar ${r.code}: ${tail}`,
    );
  }
  return r;
}

/** Tunggu proses anak (yang stdout-nya dialirkan ke tempat lain) selesai; stderr dikumpulkan untuk pesan galat. */
export function waitForExit(
  child: ChildProcess,
  name: string,
  secrets: readonly string[] = [],
): Promise<void> {
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < MAX_CAPTURE) stderr += d.toString();
  });
  return new Promise((resolvePromise, reject) => {
    child.on('error', (err) => reject(new ToolError(name, err.message)));
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else {
        const tail = redact(stderr.trim().split('\n').slice(-5).join(' | '), secrets);
        reject(new ToolError(name, `keluar ${code ?? 'sinyal'}: ${tail}`));
      }
    });
  });
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
export const DOCKER_HOST_GATEWAY = 'host.docker.internal';

/** Alamat yang dilihat kontainer untuk layanan di host: localhost → host.docker.internal. */
export function hostForDocker(host: string): string {
  return LOCAL_HOSTS.has(host) ? DOCKER_HOST_GATEWAY : host;
}

/** Argumen `docker run` bersama: hapus setelah selesai, bisa menjangkau host, dan (Linux) berkas milik pengguna. */
export function dockerRunBase(): string[] {
  const args = ['run', '--rm', `--add-host=${DOCKER_HOST_GATEWAY}:host-gateway`];
  const uid = getuid?.();
  const gid = getgid?.();
  if (uid !== undefined && gid !== undefined) args.push('--user', `${uid}:${gid}`);
  return args;
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const r = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 15_000 });
    return r.code === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Versi mayor biner lokal (`pg_dump --version` → 16), atau null bila tidak ada. */
export async function localToolMajor(cmd: string): Promise<number | null> {
  try {
    const r = await run(cmd, ['--version'], { timeoutMs: 10_000 });
    const m = /(\d+)(?:\.\d+)?/.exec(r.stdout);
    return r.code === 0 && m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export interface PgConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parsePgUrl(url: string): PgConn {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

export type ToolMode = 'docker' | 'local';
