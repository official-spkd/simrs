import { expect, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/** Mode presentasi (ADR-0023): build yang sama dengan DATA_SOURCE=demo di port 3011. */
test.describe('mode presentasi · fondasi', () => {
  test('lencana "data fiktif" selalu tampil; layar yang belum dibangun tetap redup', async ({
    page,
    viewport,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    await expect(page.getByText('Mode presentasi · data fiktif')).toBeVisible();
    if ((viewport?.width ?? 1280) < 768) return;
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav.getByTitle('IGD · layar belum tersedia').first()).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
