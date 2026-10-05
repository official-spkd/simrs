/**
 * `pnpm backup:jalankan [--jenis per-jam|harian|manual] [--tanpa-retensi]` (ADR-0071).
 * Kode keluar: 0 berhasil (tiga lokasi), 2 sebagian (backup lokal ada, lokasi jauh gagal), 1 gagal.
 */
import { parseArgs } from 'node:util';
import { runBackup } from '../backup';
import { loadConfig } from '../config';
import type { BackupKind } from '../manifest';

const KINDS: Record<string, BackupKind> = { 'per-jam': 'hourly', harian: 'daily', manual: 'manual' };

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      jenis: { type: 'string', default: 'manual' },
      'tanpa-retensi': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const kind = KINDS[values.jenis];
  if (!kind) {
    console.error(`--jenis harus salah satu dari: ${Object.keys(KINDS).join(', ')}`);
    return 1;
  }
  const cfg = loadConfig();
  const result = await runBackup(cfg, {
    kind,
    skipRetention: values['tanpa-retensi'],
    log: (m) => console.warn(`[backup] ${m}`),
  });
  console.warn(
    `[backup] ${result.backupKey}: ${result.status} · lokasi ${result.locationsOk.join(', ') || '-'}` +
      `${result.recorded ? ' · tercatat' : ' · TIDAK tercatat'}`,
  );
  for (const [loc, r] of Object.entries(result.retention)) {
    if (r.error) console.error(`[backup] retensi ${loc} gagal: ${r.error}`);
    else if (r.pruned.length) console.warn(`[backup] retensi ${loc}: hapus ${r.pruned.join(', ')}`);
  }
  for (const e of result.errors) console.error(`[backup] ${e}`);
  if (result.status === 'failed') return 1;
  return result.status === 'partial' || !result.recorded ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[backup] gagal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
