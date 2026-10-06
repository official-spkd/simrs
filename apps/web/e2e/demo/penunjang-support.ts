import { expect, type Page } from '@playwright/test';
import {
  createAccount,
  inTenant,
  TENANTS,
  submitPassword,
  totpFor,
  typeCode,
  type Account,
} from '../support/accounts';

export async function loginRole(page: Page, account: Account, roleName: string) {
  await page.goto('/');
  await submitPassword(page, account, account.password);
  await typeCode(page, totpFor(account.totpSecret!));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Masuk sebagai ${roleName}` }).click();
  await expect(
    page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
  ).toBeVisible();
}
export async function switchRole(page: Page, roleName: string) {
  await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Pindah ke ${roleName}` }).click();
  await expect(
    page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
  ).toBeVisible();
}
/** Akun uji dua petugas berbagi RS demo, sama seperti akun presentasi pengguna. Jalankan subset ini berurutan. */
export async function sharedAccount(role: string, displayName: string) {
  const account = await createAccount({
    roles: [role, 'admin_tenant', ...(role === 'apoteker' ? ['dokter'] : [])],
    displayName,
  });
  account.username = `presentasi.cx1.${account.id.slice(-12)}`;
  await inTenant(TENANTS.RSFA, (tx) =>
    tx.user.update({ where: { id: account.id }, data: { username: account.username } }),
  );
  return account;
}
export async function resetShared(page: Page, account: Account) {
  await loginRole(page, account, 'Admin SIM RS');
  await page.getByRole('button', { name: /Mode presentasi · data fiktif/ }).click();
  const menu = page.getByRole('region', { name: 'Data demo' });
  await menu.getByRole('button', { name: 'Mulai ulang data demo' }).click();
  await menu.getByRole('alertdialog').getByRole('button', { name: 'Ya, mulai ulang' }).click();
  await expect(menu).toContainText('0 aksi tersimpan');
  await page.keyboard.press('Escape');
}
