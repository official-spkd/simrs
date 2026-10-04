import { expect, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Mode presentasi (ADR-0023): build yang sama dengan DATA_SOURCE=demo di port 3011. */
test.describe('mode presentasi · fondasi', () => {
  test('lencana "data fiktif" selalu tampil; menu hanya memuat layar posisi aktif', async ({
    page,
    viewport,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    await expect(page.getByText('Mode presentasi · data fiktif')).toBeVisible();
    if ((viewport?.width ?? 1280) < 768) return;
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    // Layar perawat terbuka; layar posisi lain (kasir) tidak tampil di menu.
    await expect(nav.getByRole('link', { name: 'IGD', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Rawat inap', exact: true })).toBeVisible();
    await expect(nav.getByText('Kasir', { exact: true })).toHaveCount(0);
  });
});
