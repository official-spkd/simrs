import { expect, test } from '@playwright/test';
import {
  createAccount,
  loginAs,
  revokeSessions,
  submitPassword,
  totpFor,
  typeCode,
} from './support/accounts';

test.describe('masuk (P02/P03 lewat web)', () => {
  test('halaman staf tanpa login dialihkan ke /masuk dengan tujuan', async ({ page }) => {
    await page.goto('/sistem/akses?tab=peran');
    await expect(page).toHaveURL(/\/masuk\?lanjut=%2Fsistem%2Fakses%3Ftab%3Dperan$/);
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveText('1 Akun');
  });

  test('sandi → kode → beranda; token hanya di cookie httpOnly; keluar mencabut sesi', async ({
    page,
    context,
  }) => {
    const account = await createAccount({ roles: ['perawat'], displayName: 'Rina Wulandari, S.Kep' });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    await expect(page.getByText('Selamat datang, Rina Wulandari, S.Kep')).toBeVisible();

    const cookies = await context.cookies();
    const session = cookies.filter((c) => c.name.startsWith('simrs_'));
    expect(session.map((c) => c.name).sort()).toEqual(['simrs_at', 'simrs_rt']);
    for (const c of session) expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('simrs_');
    const html = await page.content();
    for (const c of session) expect(html).not.toContain(c.value);

    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page).toHaveURL(/\/masuk$/);
    expect((await context.cookies()).filter((c) => c.name.startsWith('simrs_'))).toEqual([]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/masuk/);
  });

  test('sandi salah: pesan seragam, tetap di langkah 1, isian nama tetap ada', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await page.goto('/masuk');
    await submitPassword(page, account, 'bukan sandinya sama sekali');
    await expect(
      page.getByRole('alert').filter({ hasText: 'NIP/email atau kata sandi salah' }),
    ).toBeVisible();
    await expect(page.getByLabel('NIP atau email RS')).toHaveValue(account.username);
    await expect(page.getByLabel('Kata sandi', { exact: true })).toHaveValue('');
  });

  test('kode salah ditolak; "kembali" memulai dari awal', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await page.goto('/masuk');
    await submitPassword(page, account, account.password);
    await typeCode(page, '000000');
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Kode verifikasi salah' })).toBeVisible();
    await page.getByRole('button', { name: 'Kembali ke halaman masuk' }).click();
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
  });

  test('dua penugasan: pilih unit, lalu kembali ke tujuan awal', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat', 'kasir'] });
    await page.goto('/?dari=uji');
    await submitPassword(page, account, account.password);
    await typeCode(page, totpFor(account.totpSecret as string));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page.getByRole('heading', { name: 'Pilih posisi dan unit kerja' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveText('3 Unit kerja');
    await page.getByText('Kasir', { exact: true }).click();
    await page.getByRole('button', { name: 'Masuk sebagai Kasir' }).click();
    await expect(page).toHaveURL(/\/\?dari=uji$/);
    await expect(page.getByText('Anda masuk sebagai Kasir')).toBeVisible();
  });

  test('akun baru: daftar MFA lewat QR → ganti sandi sementara → beranda', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'], mfa: false, mustChangePassword: true });
    await page.goto('/masuk');
    await submitPassword(page, account, account.password);
    await expect(page.getByRole('heading', { name: 'Aktifkan verifikasi dua langkah' })).toBeVisible();
    await page.getByRole('button', { name: 'Tampilkan kode QR' }).click();
    await expect(page.getByAltText('Kode QR pendaftaran aplikasi autentikator')).toBeVisible();
    const secret = (await page.getByTestId('mfa-secret').textContent())?.replace(/\s/g, '') ?? '';
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await typeCode(page, totpFor(secret));
    await page.getByRole('button', { name: 'Aktifkan dan lanjut' }).click();

    await expect(page.getByRole('heading', { name: 'Buat kata sandi baru' })).toBeVisible();
    await page.getByLabel('Kata sandi saat ini').fill(account.password);
    await page.getByLabel('Kata sandi baru', { exact: true }).fill('pendek');
    await page.getByLabel('Ulangi kata sandi baru').fill('pendek');
    await page.getByRole('button', { name: 'Simpan dan lanjut' }).click();
    // Tunggu tolakan kebijakan sandi dari API (field ditandai invalid) sebelum mengisi ulang.
    await expect(page.getByLabel('Kata sandi baru', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    const fresh = `kalimat sandi baru yang cukup panjang ${account.id.slice(-4)}`;
    await page.getByLabel('Kata sandi saat ini').fill(account.password);
    await page.getByLabel('Kata sandi baru', { exact: true }).fill(fresh);
    await page.getByLabel('Ulangi kata sandi baru').fill(fresh);
    await page.getByRole('button', { name: 'Simpan dan lanjut' }).click();
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
  });

  test('sesi dicabut di server: navigasi berikutnya kembali ke /masuk', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await revokeSessions(account);
    await page.reload();
    await expect(page).toHaveURL(/\/masuk/);
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
  });

  test('tujuan berbahaya di ?lanjut diabaikan (tidak ada open redirect)', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await page.goto('/masuk?lanjut=https%3A%2F%2Fjahat.contoh');
    await submitPassword(page, account, account.password);
    await typeCode(page, totpFor(account.totpSecret as string));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    // Path relatif dicocokkan utuh terhadap baseURL (port mengikuti E2E_WEB_PORT di playwright.config.ts).
    await expect(page).toHaveURL('/');
  });
});
