/**
 * `pnpm backup:uji-restore [--sumber lokal|cloud|offsite] [--backup <kunci>] [--kunci-privat <berkas>]
 *   [--tanpa-catat] [--simpan-kontainer] [--dokumen-ketat]` (ADR-0071). Kode keluar 0 = restore berhasil.
 */
import { parseArgs } from 'node:util';
import type { Location } from '../backup';
import { loadConfig } from '../config';
import { runRestoreTest } from '../restore';

const SOURCES: Record<string, Location> = { lokal: 'local', cloud: 'cloud', offsite: 'offsite' };

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      sumber: { type: 'string', default: 'cloud' },
      backup: { type: 'string' },
      'kunci-privat': { type: 'string' },
      'tanpa-catat': { type: 'boolean', default: false },
      'simpan-kontainer': { type: 'boolean', default: false },
      'dokumen-ketat': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const source = SOURCES[values.sumber];
  if (!source) {
    console.error(`--sumber harus salah satu dari: ${Object.keys(SOURCES).join(', ')}`);
    return 1;
  }
  const cfg = loadConfig(
    values['kunci-privat']
      ? { ...process.env, BACKUP_PRIVATE_KEY_FILE: values['kunci-privat'] }
      : process.env,
  );
  const report = await runRestoreTest(cfg, {
    source,
    backupKey: values.backup,
    record: !values['tanpa-catat'],
    keepContainers: values['simpan-kontainer'],
    strictDocuments: values['dokumen-ketat'],
    log: (m) => console.warn(`[uji-restore] ${m}`),
  });
  console.warn(
    `[uji-restore] ${report.status === 'success' ? 'BERHASIL' : 'GAGAL'} · ${report.source}:${report.backupKey ?? '-'}` +
      ` · RTO ${report.rtoSeconds} dtk · ${report.recorded ? 'tercatat di restore_tests' : 'tidak dicatat'}` +
      ` · laporan ${report.reportFile}`,
  );
  if (report.error) console.error(`[uji-restore] ${report.error}`);
  return report.status === 'success' ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[uji-restore] gagal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
