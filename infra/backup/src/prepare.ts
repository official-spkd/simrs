/**
 * Tahap restore yang sama untuk uji restore dan pemulihan sungguhan (ADR-0071): pilih → ambil → manifest → checksum →
 * kunci → dekripsi dump → dekripsi + ekstrak dokumen. Urut dari yang tidak membuat apa pun: manifest rusak, berkas
 * rusak, dan kunci salah gagal sebelum satu byte plaintext ditulis. Keluaran hanya ke folder baru (tidak menimpa).
 */
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Location } from './backup';
import type { BackupConfig } from './config';
import { createDecryptStream, HEADER_BYTES, headerKeyId, type IdentityKey, loadPrivateKey } from './crypto';
import {
  DB_FILE,
  DOCUMENTS_FILE,
  MANIFEST_FILE,
  type Manifest,
  parseBackupKey,
  parseManifest,
} from './manifest';
import { Mc } from './mc';
import type { StoredRun } from './retention';
import { DigestTap, sha256File, writeAtomically } from './streams';
import { type ExtractResult, extractTar } from './tar';
import { localToolMajor } from './tools';

/** Pembungkus langkah: mencatat hasil/waktu dan melempar galat berlabel langkah. */
export type StepFn = <T>(
  name: string,
  fn: () => Promise<T>,
  detail?: (v: T) => string | undefined,
) => Promise<T>;

export async function listLocalRuns(dir: string): Promise<StoredRun[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: StoredRun[] = [];
  for (const name of names) {
    if (!parseBackupKey(name)) continue;
    const complete = await stat(join(dir, name, MANIFEST_FILE)).then(
      () => true,
      () => false,
    );
    out.push({ key: name, complete });
  }
  return out;
}

/** Backup lengkap terbaru (atau yang diminta) di satu lokasi. */
export function pickBackup(runs: readonly StoredRun[], wanted?: string): string {
  const complete = runs
    .filter((r) => r.complete && parseBackupKey(r.key))
    .sort(
      (a, b) =>
        (parseBackupKey(b.key)?.startedAt.getTime() ?? 0) - (parseBackupKey(a.key)?.startedAt.getTime() ?? 0),
    );
  if (wanted) {
    if (!complete.some((r) => r.key === wanted)) {
      throw new Error(`backup ${wanted} tidak ada atau tidak lengkap`);
    }
    return wanted;
  }
  const latest = complete[0];
  if (!latest) throw new Error('tidak ada backup lengkap di lokasi ini');
  return latest.key;
}

async function readHeader(path: string): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export interface PrepareOptions {
  source: Location;
  backupKey?: string;
  /** Folder kerja baru: `unduhan/` (lokasi jauh), `db.dump`, `storage/`. */
  workDir: string;
  step: StepFn;
  /** Dipanggil begitu backup terpilih (agar laporan tetap memuat kuncinya bila langkah berikut gagal). */
  onSelected?: (key: string) => void;
}

export interface PreparedBackup {
  backupKey: string;
  manifest: Manifest;
  /** Dump format custom pg_dump, plaintext (0600). */
  dumpPath: string;
  /** Root penyimpanan dokumen hasil ekstrak (`<tenant>/<tahun>/<bulan>/<uuid>`). */
  storageDir: string;
  documents: ExtractResult;
}

export async function prepareBackup(cfg: BackupConfig, opts: PrepareOptions): Promise<PreparedBackup> {
  const { step } = opts;
  await mkdir(opts.workDir, { recursive: true, mode: 0o700 });
  const mc =
    opts.source === 'local'
      ? null
      : new Mc(
          (await localToolMajor('mc')) !== null && cfg.tools !== 'docker' ? 'local' : 'docker',
          [cfg.primary, cfg.offsite],
          cfg.mcImage,
        );
  const target = opts.source === 'offsite' ? cfg.offsite : cfg.primary;

  // 1. Pilih backup.
  const key = await step(
    'select',
    async () =>
      pickBackup(
        mc ? await mc.listRuns(target, cfg.prefix) : await listLocalRuns(cfg.localDir),
        opts.backupKey,
      ),
    (k) => `${opts.source}:${k}`,
  );
  opts.onSelected?.(key);

  // 2. Ambil berkas (lokal dibaca di tempat, tanpa disalin).
  const runDir = await step('fetch', async () => {
    if (!mc) return join(cfg.localDir, key);
    const dest = join(opts.workDir, 'unduhan');
    await mkdir(dest, { mode: 0o700 });
    await mc.downloadRun(target, cfg.prefix, key, dest);
    return dest;
  });

  // 3. Manifest: rusak = gagal keras, sebelum apa pun dibuat.
  const manifest = await step(
    'manifest',
    async () => parseManifest(await readFile(join(runDir, MANIFEST_FILE), 'utf8'), key),
    (m) =>
      `${Object.keys(m.database.tables).length} tabel, ${m.database.auditHeads.length} rantai audit, ` +
      `${m.documents.fileCount} dokumen`,
  );

  // 4. Checksum berkas terenkripsi (tanpa kunci privat).
  await step('checksum', async () => {
    for (const f of [manifest.database.file, manifest.documents.file]) {
      const got = await sha256File(join(runDir, f.name));
      if (got.sha256 !== f.encSha256 || got.bytes !== f.encBytes) {
        throw new Error(`CHECKSUM_MISMATCH: ${f.name} tidak sama dengan manifest`);
      }
    }
  });

  // 5. Kunci privat: harus milik penerima backup ini. Kunci salah = berhenti di sini.
  const identity: IdentityKey = await step(
    'key',
    async () => {
      if (!cfg.privateKeyFile) throw new Error('BACKUP_PRIVATE_KEY_FILE / --kunci-privat belum diberikan');
      const idk = loadPrivateKey(await readFile(cfg.privateKeyFile, 'utf8'), cfg.privateKeyPassphrase);
      if (idk.id !== manifest.encryption.recipientKeyId) {
        throw new Error(
          `KEY_MISMATCH: backup untuk kunci ${manifest.encryption.recipientKeyId}, kunci privat ${idk.id}`,
        );
      }
      for (const f of [DB_FILE, DOCUMENTS_FILE]) {
        const hid = headerKeyId(await readHeader(join(runDir, f)));
        if (hid !== idk.id) throw new Error(`KEY_MISMATCH: header ${f} untuk kunci ${hid}`);
      }
      return idk;
    },
    (k) => `kunci ${k.id}`,
  );

  // 6. Dekripsi dump (berkas baru 0600), cocokkan hash plaintext.
  const dumpPath = join(opts.workDir, 'db.dump');
  await step('decrypt', async () => {
    const tap = new DigestTap();
    await writeAtomically(dumpPath, [
      createReadStream(join(runDir, DB_FILE)),
      createDecryptStream(identity),
      tap,
    ]);
    if (
      tap.digest() !== manifest.database.file.plainSha256 ||
      tap.bytes !== manifest.database.file.plainBytes
    ) {
      throw new Error('PLAINTEXT_MISMATCH: hasil dekripsi dump tidak sama dengan manifest');
    }
  });

  // 7. Dokumen: dekripsi + ekstrak langsung (arsip plaintext tidak disimpan).
  const storageDir = join(opts.workDir, 'storage');
  await mkdir(storageDir, { mode: 0o700 });
  const documents = await step(
    'documents',
    async () => {
      const tap = new DigestTap();
      const out: { result?: ExtractResult } = {};
      await pipeline(
        createReadStream(join(runDir, DOCUMENTS_FILE)),
        createDecryptStream(identity),
        tap,
        async (source) => {
          out.result = await extractTar(source, storageDir);
        },
      );
      const result = out.result;
      if (!result) throw new Error('arsip dokumen tidak terbaca');
      if (tap.digest() !== manifest.documents.file.plainSha256) {
        throw new Error('PLAINTEXT_MISMATCH: arsip dokumen');
      }
      if (
        result.files !== manifest.documents.fileCount ||
        result.totalBytes !== manifest.documents.totalBytes
      ) {
        throw new Error(
          `DOCUMENTS_MISMATCH: ${result.files} berkas/${result.totalBytes} B, ` +
            `manifest ${manifest.documents.fileCount}/${manifest.documents.totalBytes}`,
        );
      }
      return result;
    },
    (r) => `${r.files} berkas, ${r.totalBytes} B`,
  );

  return { backupKey: key, manifest, dumpPath, storageDir, documents };
}
