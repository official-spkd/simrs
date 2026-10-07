import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { DEMO_ACCOUNTS_FILE } from '../demo-accounts-file';
import { type Account, createAccount, loginAs, submitPassword, totpFor, typeCode } from '../support/accounts';
import { E2E_WEB_PORT } from '../support/slot';

/**
 * Toko keadaan demo bersama (ADR-0085), contoh migrasi "Catat pelaporan nilai kritis": aksi di Lab tersimpan →
 * bertahan setelah muat ulang dan ganti posisi → tampil di Pusat hasil kritis atas nama pengguna sesi → "Mulai ulang
 * data demo" mengembalikan keadaan awal. Akun uji punya ruang data sendiri (akun presentasi berbagi satu per RS),
 * sehingga tes paralel tidak saling mengganggu.
 */

const STATE_DIR = dirname(DEMO_ACCOUNTS_FILE);
const API_WEB = `http://localhost:${E2E_WEB_PORT}`;
const spaceFile = (a: Account) =>
  join(STATE_DIR, 'toko', `${a.tenantCode}-${a.id.replace(/[^A-Za-z0-9]/g, '')}`.toUpperCase() + '.json');

async function loginWithPosition(page: Page, account: Account, roleName: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/masuk/);
  await submitPassword(page, account, account.password);
  await typeCode(page, totpFor(account.totpSecret as string));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih posisi dan unit kerja' })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Masuk sebagai ${roleName}` }).click();
  await expect(page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName}`))).toBeVisible();
}

async function switchPosition(page: Page, roleName: string) {
  await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ganti posisi', level: 1 })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Pindah ke ${roleName}` }).click();
  await expect(page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName}`))).toBeVisible();
}

function dataMenu(page: Page) {
  return {
    open: () => page.getByRole('button', { name: /Mode presentasi · data fiktif/ }).click(),
    panel: page.getByRole('region', { name: 'Data demo' }),
  };
}

test.describe('toko demo bersama', () => {
  test('lapor nilai kritis di Lab → bertahan → Pusat hasil kritis → mulai ulang data demo', async ({
    page,
  }) => {
    const akun = await createAccount({
      roles: ['analis_lab', 'manajemen'],
      displayName: 'Analis Toko Fiktif',
    });
    await loginWithPosition(page, akun, 'Analis laboratorium');
    await page.goto('/penunjang/lab');

    // Aksi: catat pelaporan nilai kritis Tn. Yusuf (penerima + read-back wajib).
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf Hidayat/ });
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Penerima Toko Fiktif');
    await kritis.getByRole('checkbox', { name: /Read-back/ }).check();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    const dilaporkan = page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Yusuf Hidayat/ });
    await expect(dilaporkan).toContainText('Diterima dr. Penerima Toko Fiktif');
    await expect(dilaporkan).not.toContainText('tidak disimpan');
    await expect.poll(() => existsSync(spaceFile(akun))).toBe(true);

    // Muat ulang: masih ada.
    await page.reload();
    await expect(dilaporkan).toContainText('Diterima dr. Penerima Toko Fiktif');
    await expect(page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf/ })).toHaveCount(0);

    // Menu data demo: ringkasan; analis tidak bisa memulai ulang.
    const menu = dataMenu(page);
    await menu.open();
    await expect(menu.panel).toContainText('1 aksi tersimpan');
    await expect(menu.panel).toContainText('Ruang data akun ini saja');
    await expect(menu.panel.getByRole('button', { name: 'Mulai ulang data demo' })).toHaveCount(0);
    await expect(menu.panel).toContainText('hanya untuk admin SIM RS, manajemen, atau Superadmin demo');
    await page.keyboard.press('Escape');

    // Layar kedua: Pusat hasil kritis menampilkan laporan atas nama pengguna sesi.
    await page.goto('/penunjang/hasil-kritis');
    const list = page.getByRole('region', { name: 'Daftar hasil kritis' });
    await list.getByRole('button', { name: /Tn\. Yusuf Hidayat/ }).click();
    const detail = page.getByRole('region', { name: 'Detail hasil kritis' });
    await expect(detail).toContainText('Dilaporkan ke dr. Penerima Toko Fiktif (DPJP / dokter jaga)');
    await expect(detail).toContainText('oleh Analis Toko Fiktif');
    await expect(detail.getByRole('button', { name: 'Catat pelaporan' })).toHaveCount(0);

    // Ganti posisi: data tetap; manajemen boleh memulai ulang (berkonfirmasi).
    await switchPosition(page, 'Manajemen');
    await menu.open();
    await expect(menu.panel).toContainText('1 aksi tersimpan');
    await menu.panel.getByRole('button', { name: 'Mulai ulang data demo' }).click();
    const confirm = menu.panel.getByRole('alertdialog');
    await expect(confirm).toContainText('Semua aksi tersimpan akun ini dihapus');
    await confirm.getByRole('button', { name: 'Batal' }).click();
    await expect(menu.panel).toContainText('1 aksi tersimpan');
    await menu.panel.getByRole('button', { name: 'Mulai ulang data demo' }).click();
    await menu.panel.getByRole('alertdialog').getByRole('button', { name: 'Ya, mulai ulang' }).click();
    await expect(menu.panel.getByRole('status')).toContainText('kembali ke keadaan awal');
    await expect(menu.panel).toContainText('0 aksi tersimpan');
    await expect(menu.panel).toContainText('oleh Analis Toko Fiktif');

    // Kembali ke awal: nilai kritis Tn. Yusuf terbuka lagi di Lab.
    await switchPosition(page, 'Analis laboratorium');
    await page.goto('/penunjang/lab');
    await expect(
      page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf Hidayat/ }),
    ).toBeVisible();
  });

  test('mode api: layar toko 404, tanpa menu data demo, toko tidak tersentuh', async ({ page }) => {
    const akun = await createAccount({ roles: ['analis_lab'] });
    await loginAs(page, akun, `${API_WEB}/`);
    // Layar yang hanya punya jalur toko demo: 404 di mode api.
    for (const route of ['/keuangan/kasir', '/manajemen/sdm']) {
      expect((await page.goto(`${API_WEB}${route}`))?.status(), route).toBe(404);
    }
    // Lab dan Hasil kritis kini hibrida (fase 4 potongan 4.0c): terbuka di mode api tanpa data fiktif dan tanpa
    // menyentuh toko demo.
    for (const route of ['/penunjang/lab', '/penunjang/hasil-kritis']) {
      expect((await page.goto(`${API_WEB}${route}`))?.status(), route).toBe(200);
      await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    }
    await page.goto(`${API_WEB}/`);
    await expect(page.getByRole('button', { name: /Mode presentasi/ })).toHaveCount(0);
    expect(existsSync(spaceFile(akun))).toBe(false);
  });
});
