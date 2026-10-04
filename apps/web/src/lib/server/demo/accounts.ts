import 'server-only';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { USERNAME } from '@simrs/shared';
import { z } from 'zod';
import type { PersonaView } from '../../demo/personas';
import { assertDemo } from '../demo-guard';

/**
 * Akun presentasi (ADR-0023): kredensial lokal yang dibuat `pnpm db:akun-presentasi` di `.local/demo-accounts.json`.
 * Dibaca HANYA di mode presentasi (lokal + DATA_SOURCE=demo) dan hanya di server; rahasia tidak pernah dikirim ke
 * browser. Web memakainya untuk menjalankan login biasa (sandi + kode TOTP) atas nama presenter.
 */

const fileSchema = z.strictObject({
  format: z.literal(1),
  tenantCode: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/),
  createdAt: z.string(),
  accounts: z
    .array(
      z.strictObject({
        username: USERNAME,
        password: z.string().min(12).max(128),
        totpSecret: z.string().regex(/^[A-Z2-7]{16,64}$/),
        displayName: z.string().min(1).max(120),
        role: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
        roleName: z.string().min(1).max(80),
        unitName: z.string().max(120).nullable(),
      }),
    )
    .max(40),
});

export type PresentationAccounts = z.infer<typeof fileSchema>;
export type PresentationAccount = PresentationAccounts['accounts'][number];

export function demoAccountsFile(env: Record<string, string | undefined> = process.env): string {
  return env.DEMO_ACCOUNTS_FILE
    ? resolve(env.DEMO_ACCOUNTS_FILE)
    : resolve(process.cwd(), '../../.local/demo-accounts.json');
}

/** Berkas kredensial; null bila belum dibuat atau tidak sah (layar masuk menampilkan cara membuatnya). */
export async function loadPresentationAccounts(): Promise<PresentationAccounts | null> {
  assertDemo();
  let raw: string;
  try {
    raw = await readFile(demoAccountsFile(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = fileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Daftar akun untuk ditampilkan (tanpa sandi dan rahasia TOTP). */
export function publicPersonas(file: PresentationAccounts): PersonaView[] {
  return file.accounts.map(({ username, displayName, role, roleName, unitName }) => ({
    username,
    displayName,
    role,
    roleName,
    unitName,
  }));
}
