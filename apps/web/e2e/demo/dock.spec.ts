import { expect, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Navigasi dock (ADR-0092). Suite lain berjalan dengan bawaan `NAV_LAYOUT=sidebar`; di sini cookie pilihan pengguna
 * memaksa dock, sehingga cookie dibuktikan menang atas bawaan server.
 */
test.describe('navigasi dock', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'simrs_nav', value: 'dock', url: baseURL ?? 'http://localhost' }]);
  });

  test('ikon membuka stack layar di atasnya; Esc menutup; tautan stack membuka layar; akun di stack Akun', async ({
    page,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    const dock = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(dock).toBeVisible();
    const klinis = dock.getByRole('button', { name: /^Klinis · \d+ layar$/ });
    const igd = dock.getByRole('link', { name: 'IGD', exact: true });

    await expect(klinis).toHaveAttribute('aria-expanded', 'false');
    await expect(igd).toBeHidden();
    await klinis.click();
    await expect(klinis).toHaveAttribute('aria-expanded', 'true');
    await expect(igd).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(klinis).toHaveAttribute('aria-expanded', 'false');
    await expect(klinis).toBeFocused();

    // Klik di luar dock juga menutup.
    await klinis.click();
    await page.getByRole('heading', { level: 1 }).first().click();
    await expect(klinis).toHaveAttribute('aria-expanded', 'false');

    await klinis.click();
    await igd.click();
    await expect(page).toHaveURL(/\/klinis\/igd$/);
    await expect(klinis).toHaveAttribute('aria-expanded', 'false');
    await klinis.click();
    await expect(igd).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');

    // Identitas, unit, dan Keluar ada di stack Akun.
    const akun = dock.getByRole('button', { name: /^Akun · / });
    await akun.click();
    await expect(dock.getByText('Perawat', { exact: true })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Keluar' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('tombol Cari di dock membuka palet perintah', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'Cari layar' }).click();
    const palette = page.getByRole('dialog', { name: 'Palet perintah' });
    await expect(palette).toBeVisible();
    await page.getByRole('combobox').fill('rawat inap');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/klinis\/rawat-inap/);
  });

  test('pilihan Sidebar tersimpan setelah muat ulang, lalu kembali ke Dock', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 1280) < 768, 'pemilih tampilan hanya tampil mulai 768 px');
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    const toggle = page.getByRole('group', { name: 'Tampilan navigasi' });
    await expect(toggle.getByRole('button', { name: 'Dock' })).toHaveAttribute('aria-pressed', 'true');

    await toggle.getByRole('button', { name: 'Sidebar' }).click();
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav.getByRole('link', { name: 'IGD', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: /^Klinis · / })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('group', { name: 'Tampilan navigasi' }).getByRole('button', { name: 'Sidebar' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(nav.getByRole('link', { name: 'IGD', exact: true })).toBeVisible();

    await toggle.getByRole('button', { name: 'Dock' }).click();
    await expect(nav.getByRole('button', { name: /^Klinis · / })).toBeVisible();
  });
});
