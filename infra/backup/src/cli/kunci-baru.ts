/**
 * `pnpm backup:kunci-baru --keluar <folder> [--frasa-sandi-env NAMA_VAR]` (ADR-0071).
 * Membuat pasangan kunci X25519: `simrs-backup.pub` (dipasang di host backup sebagai BACKUP_PUBLIC_KEY) dan
 * `simrs-backup.key` (PKCS#8, 0600; disimpan OFFLINE oleh dua pemegang, tidak pernah di repo atau host backup).
 * Dengan --frasa-sandi-env, kunci privat dienkripsi frasa sandi dari variabel itu (berkas + frasa dipegang orang
 * berbeda). Tidak pernah menimpa berkas yang sudah ada.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generateBackupKeyPair } from '../crypto';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      keluar: { type: 'string' },
      'frasa-sandi-env': { type: 'string' },
    },
    strict: true,
  });
  if (!values.keluar) {
    console.error('--keluar <folder> wajib (folder di media offline, bukan di repo)');
    return 1;
  }
  let passphrase: string | undefined;
  if (values['frasa-sandi-env']) {
    passphrase = process.env[values['frasa-sandi-env']];
    if (!passphrase || passphrase.length < 12) {
      console.error(`Variabel ${values['frasa-sandi-env']} kosong atau < 12 karakter`);
      return 1;
    }
  }
  const dir = resolve(values.keluar);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const pair = generateBackupKeyPair(passphrase);
  await writeFile(join(dir, 'simrs-backup.key'), pair.privateKeyPem, { flag: 'wx', mode: 0o600 });
  await writeFile(join(dir, 'simrs-backup.pub'), `${pair.publicKey}\n`, { flag: 'wx', mode: 0o644 });
  console.warn(`Kunci ${pair.keyId} dibuat di ${dir}`);
  console.warn(`Pasang di host backup: BACKUP_PUBLIC_KEY=${pair.publicKey}`);
  console.warn(
    'Simpan simrs-backup.key offline (dua salinan, dua pemegang); jangan salin ke host backup atau repo.',
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[kunci-baru] gagal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
