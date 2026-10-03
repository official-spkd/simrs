import { expect, type Page } from '@playwright/test';
import { createPrismaClient, type PrismaClient, withTenant } from '@simrs/db';
import { SEED_PLATFORM_TENANT, testDbUrls } from '@simrs/db/testing';
import { newId } from '@simrs/shared';
import {
  base32Decode,
  encryptField,
  generateTotpSecret,
  hashPassword,
  totpCode,
  totpStep,
} from '@simrs/shared/node';

/** Akun uji fiktif dibuat langsung di simrs_test (role aplikasi, RLS aktif). Nama pengguna unik per tes. */

const TENANTS = {
  RSFA: '0199a000-0000-7000-8000-000000000001',
  PLATFORM: SEED_PLATFORM_TENANT.id,
} as const;
export type TenantCode = keyof typeof TENANTS;

export interface Account {
  id: string;
  tenantCode: TenantCode;
  username: string;
  password: string;
  displayName: string;
  totpSecret: string | null;
}

let db: PrismaClient | undefined;
function prisma(): PrismaClient {
  db ??= createPrismaClient({ connectionString: testDbUrls().app, max: 2 });
  return db;
}

export async function createAccount(
  opts: {
    tenant?: TenantCode;
    roles?: string[];
    mfa?: boolean;
    mustChangePassword?: boolean;
    displayName?: string;
  } = {},
): Promise<Account> {
  const tenantCode = opts.tenant ?? 'RSFA';
  const tenantId = TENANTS[tenantCode];
  const id = newId();
  const account: Account = {
    id,
    tenantCode,
    username: `e2e.${id.slice(-12)}`,
    password: `frasa uji e2e panjang ${id.slice(-6)}`,
    displayName: opts.displayName ?? 'Pengguna E2E Fiktif',
    totpSecret: opts.mfa === false ? null : generateTotpSecret(),
  };
  const passwordHash = await hashPassword(account.password);
  await withTenant(prisma(), tenantId, async (tx) => {
    await tx.user.create({
      data: {
        id,
        tenantId,
        username: account.username,
        displayName: account.displayName,
        mustChangePassword: opts.mustChangePassword ?? false,
      },
    });
    await tx.userCredential.create({ data: { userId: id, tenantId, passwordHash } });
    for (const code of opts.roles ?? []) {
      const role = await tx.role.findFirstOrThrow({ where: { code } });
      await tx.staffAssignment.create({ data: { id: newId(), tenantId, userId: id, roleId: role.id } });
    }
    if (account.totpSecret) {
      await tx.mfaFactor.create({
        data: {
          id: newId(),
          tenantId,
          userId: id,
          secretEnc: encryptField(account.totpSecret, {
            keyB64: process.env.FIELD_ENCRYPTION_KEY ?? '',
            tenantId,
            purpose: 'mfa_secret',
          }),
          confirmedAt: new Date(),
        },
      });
    }
  });
  return account;
}

/** Cabut semua sesi akun (mis. dinonaktifkan admin di tempat lain). */
export async function revokeSessions(account: Account): Promise<void> {
  await withTenant(prisma(), TENANTS[account.tenantCode], (tx) =>
    tx.authSession.updateMany({
      where: { userId: account.id, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date(), revokedReason: 'e2e' },
    }),
  );
}

/** Kode TOTP untuk langkah waktu berikutnya yang belum dipakai (API menolak pemakaian ulang). */
const lastStep = new Map<string, number>();
export function totpFor(secret: string): string {
  const step = Math.max(totpStep(), (lastStep.get(secret) ?? -Infinity) + 1);
  if (step > totpStep() + 1) throw new Error('Kode TOTP habis untuk jendela ini');
  lastStep.set(secret, step);
  return totpCode(base32Decode(secret), step);
}

/** Langkah 1 (+ kode RS di lokal). */
export async function submitPassword(
  page: Page,
  account: Pick<Account, 'tenantCode' | 'username'>,
  password: string,
) {
  await page.getByLabel('Kode RS').fill(account.tenantCode);
  await page.getByLabel('NIP atau email RS').fill(account.username);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk dan minta kode' }).click();
}

export async function typeCode(page: Page, code: string) {
  await page.getByLabel('Digit 1').pressSequentially(code);
}

/** Login penuh untuk akun ber-MFA dengan satu penugasan; berakhir di halaman tujuan. */
export async function loginAs(page: Page, account: Account, path = '/'): Promise<void> {
  if (!account.totpSecret) throw new Error('Akun tanpa MFA');
  await page.goto(path);
  await expect(page).toHaveURL(/\/masuk/);
  await submitPassword(page, account, account.password);
  await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  await typeCode(page, totpFor(account.totpSecret));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await expect(page).not.toHaveURL(/\/masuk/);
}
