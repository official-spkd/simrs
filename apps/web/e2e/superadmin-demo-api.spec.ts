import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { base32Decode, totpCode, totpStep } from '@simrs/shared/node';
import { ALL_ACCESS_USERNAME } from '../src/lib/demo/personas';
import { DEMO_ACCOUNTS_FILE } from './demo-accounts-file';
import { type Account, createAccount, loginAs, submitPassword, typeCode } from './support/accounts';

/**
 * Posisi Superadmin demo di mode api (ADR-0023 keputusan 10): tanda "semua layar" hanya berlaku di mode presentasi.
 * Di web mode api (DATA_SOURCE=api) akun yang sama hanyalah akun berperan `manajemen`: menu identik dengan akun
 * manajemen biasa, layar data dummy 404, panduan 404. Kredensial akun presentasi uji dibuat global setup.
 */

interface CredentialFile {
  tenantCode: string;
  accounts: Array<{ username: string; password: string; totpSecret: string; allAccess?: true }>;
}

async function sidebarLinks(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await expect(nav).toBeVisible();
  const hrefs = await nav.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return [...new Set(hrefs)].sort();
}

test('mode api: akun Superadmin demo tanpa kuasa tambahan (menu = manajemen biasa, layar demo dan panduan 404)', async ({
  page: demo,
  browser,
}) => {
  test.setTimeout(180_000);
  const file = JSON.parse(readFileSync(DEMO_ACCOUNTS_FILE, 'utf8')) as CredentialFile;
  const cred = file.accounts.find((a) => a.allAccess);
  expect(cred?.username).toBe(ALL_ACCESS_USERNAME);
  if (!cred) return;

  await demo.goto('/');
  await expect(demo).toHaveURL(/\/masuk/);
  // Mode api tidak menampilkan "Masuk cepat": login biasa (sandi + kode verifikasi).
  await expect(demo.getByRole('region', { name: 'Masuk cepat · mode presentasi' })).toHaveCount(0);
  await submitPassword(
    demo,
    { tenantCode: file.tenantCode as Account['tenantCode'], username: cred.username },
    cred.password,
  );
  await expect(demo.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  // API menolak kode yang langkahnya tidak lebih baru dari kode terakhir akun ini; Masuk cepat di spesifikasi mode
  // presentasi memakai akun yang sama. Bila bentrok, tunggu langkah berikutnya lalu ulangi dengan kode baru.
  const home = demo.getByRole('heading', { name: 'Beranda', level: 1 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const digits = demo.getByRole('group', { name: 'Kode verifikasi' }).getByRole('textbox');
    for (const box of await digits.all()) await box.fill('');
    await typeCode(demo, totpCode(base32Decode(cred.totpSecret), totpStep() + 1));
    await demo.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    const ok = await home.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (ok) break;
    await demo.waitForTimeout(31_000);
  }
  await expect(home).toBeVisible();
  await expect(demo.getByText(/Anda masuk sebagai\s*Manajemen/)).toBeVisible();
  await expect(demo.getByLabel('Bertindak sebagai')).toHaveCount(0);

  // Konteks terpisah (cookie sesi per konteks), dengan baseURL proyek.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const manajemen = await other.newPage();
  await loginAs(manajemen, await createAccount({ roles: ['manajemen'] }));
  expect(await sidebarLinks(demo)).toEqual(await sidebarLinks(manajemen));
  expect(await sidebarLinks(demo)).not.toContain('/superadmin/panduan');

  // Layar khusus presentasi dan panduan superadmin tidak ada di mode api. (CPPT kini hibrida: lihat smoke.spec.)
  for (const path of ['/superadmin/panduan', '/simulasi', '/keuangan/kasir', '/manajemen/sdm']) {
    expect((await demo.goto(path))?.status(), path).toBe(404);
  }
  // Layar klinis hibrida terbuka sesuai izin sungguhan: akun demo (manajemen) ditolak, bukan diberi kuasa tambahan.
  expect((await demo.goto('/klinis/cppt'))?.status()).toBe(200);
  await expect(demo.getByText('Akses ditolak')).toBeVisible();
  await other.close();
});
