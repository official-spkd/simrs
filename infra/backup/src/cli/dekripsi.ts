/**
 * `pnpm backup:dekripsi --keluar <folder baru> [--sumber lokal|cloud|offsite] [--backup <kunci>] [--kunci-privat <berkas>]`
 * Pemulihan sungguhan (ADR-0071, runbook docs/panduan/04-backup-restore.md §7): ambil backup, periksa manifest,
 * checksum, dan kunci, lalu tulis `db.dump` (untuk pg_restore) + `storage/` (root berkas dokumen) ke folder yang
 * BELUM ada. Tidak menyentuh database atau penyimpanan mana pun; tidak pernah menimpa berkas.
 */
import { access, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Location, shortError } from '../backup';
import { loadConfig } from '../config';
import { prepareBackup, type StepFn } from '../prepare';

const SOURCES: Record<string, Location> = { lokal: 'local', cloud: 'cloud', offsite: 'offsite' };

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      keluar: { type: 'string' },
      sumber: { type: 'string', default: 'cloud' },
      backup: { type: 'string' },
      'kunci-privat': { type: 'string' },
    },
    strict: true,
  });
  const source = SOURCES[values.sumber];
  if (!source || !values.keluar) {
    console.error('--keluar <folder baru> wajib; --sumber lokal|cloud|offsite');
    return 1;
  }
  const out = resolve(values.keluar);
  if (
    await access(out).then(
      () => true,
      () => false,
    )
  ) {
    console.error(`${out} sudah ada: pilih folder baru (berkas tidak pernah ditimpa)`);
    return 1;
  }
  const cfg = loadConfig(
    values['kunci-privat']
      ? { ...process.env, BACKUP_PRIVATE_KEY_FILE: values['kunci-privat'] }
      : process.env,
  );
  const step: StepFn = async (name, fn, detail) => {
    try {
      const v = await fn();
      const d = detail?.(v);
      console.warn(`[dekripsi] ✓ ${name}${d ? ` · ${d}` : ''}`);
      return v;
    } catch (err) {
      throw new Error(`${name}: ${shortError(err)}`, { cause: err });
    }
  };
  // Kerja di folder sementara bersebelahan, lalu rename: folder keluaran hanya muncul bila semua langkah lolos.
  const work = `${out}.sedang-dikerjakan`;
  try {
    const p = await prepareBackup(cfg, { source, backupKey: values.backup, workDir: work, step });
    await rm(join(work, 'unduhan'), { recursive: true, force: true });
    await rename(work, out);
    console.warn(
      `[dekripsi] ${p.backupKey} → ${out}/db.dump (pg_restore) + ${out}/storage (${p.documents.files} dokumen)`,
    );
    return 0;
  } catch (err) {
    await rm(work, { recursive: true, force: true });
    console.error(`[dekripsi] gagal: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[dekripsi] gagal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
