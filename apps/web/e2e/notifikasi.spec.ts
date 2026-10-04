import { expect, test } from '@playwright/test';
import { createAccount, createNotification, loginAs } from './support/accounts';

test.describe('notifikasi (P09)', () => {
  test('lonceng menghitung yang baru; buka notifikasi → ditandai dibaca dan menuju tautannya', async ({
    page,
  }) => {
    const privasi = await createAccount({ roles: ['petugas_privasi'] });
    await createNotification(privasi, {
      title: 'Akses darurat digunakan',
      body: 'Seorang staf membuka rekam medis lewat akses darurat. Tinjau alasannya.',
      link: '/sistem/audit?rentang=hari-ini',
    });
    await createNotification(privasi, {
      title: 'Pemberitahuan sistem',
      body: 'Uji tanpa tautan.',
      link: null,
    });
    await loginAs(page, privasi, '/');
    await expect(page.getByRole('link', { name: 'Notifikasi, 2 baru' })).toBeVisible();
    await page.getByRole('link', { name: 'Notifikasi, 2 baru' }).click();
    await expect(page.getByRole('heading', { name: 'Notifikasi', level: 1 })).toBeVisible();
    await expect(page.getByText('2 belum dibaca')).toBeVisible();

    await page.getByRole('button', { name: /Akses darurat digunakan/ }).click();
    await expect(page).toHaveURL(/\/sistem\/audit\?rentang=hari-ini$/);
    await expect(page.getByRole('link', { name: 'Notifikasi, 1 baru' })).toBeVisible();

    await page.goto('/notifikasi');
    await page.getByRole('button', { name: 'Tandai semua dibaca' }).click();
    await expect(page.getByText('Semua sudah dibaca')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notifikasi, tidak ada yang baru' })).toBeVisible();
  });

  test('admin mengisi no. HP staf untuk WhatsApp: tersimpan dan tampil tersamar', async ({ page }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    const staff = await createAccount({ roles: ['petugas_privasi'], displayName: 'Lestari Ayu' });
    await loginAs(page, admin, '/sistem/akses');
    await page.getByLabel('Cari pengguna').fill(staff.username);
    await page.getByRole('button', { name: 'Terapkan' }).click();
    await page.getByRole('link', { name: new RegExp(staff.username) }).click();
    await expect(page.getByRole('heading', { name: 'Kontak notifikasi', level: 3 })).toBeVisible();

    await page.getByLabel('No. HP / WhatsApp', { exact: true }).fill('12345');
    await page.getByRole('button', { name: 'Simpan kontak' }).click();
    await expect(page.getByText('No. HP tidak valid (contoh 0812-3456-7890)')).toBeVisible();
    await page.getByLabel('No. HP / WhatsApp', { exact: true }).fill('0812-3456-7890');
    await page.getByRole('button', { name: 'Simpan kontak' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Kontak disimpan' })).toBeVisible();
    await expect(page.getByText(/HP 0812•••7890/)).toBeVisible();
  });
});
