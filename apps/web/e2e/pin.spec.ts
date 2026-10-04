import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs, submitPassword, totpFor, typeCode } from './support/accounts';

/** P02 · PIN masuk cepat per perangkat terdaftar (docs/05 §1, ADR-0024) lewat web. */

const PIN = '730594';
const WRONG = '730595';

async function registerPin(page: Page, password: string) {
  await page.getByRole('link', { name: 'PIN masuk cepat' }).first().click();
  await expect(page.getByRole('heading', { name: 'PIN masuk cepat', level: 1 })).toBeVisible();
  await page.getByLabel('PIN baru (6 digit)').fill(PIN);
  await page.getByLabel('Ulangi PIN').fill(PIN);
  await page.getByLabel('Kata sandi saat ini').fill(password);
  await page.getByRole('button', { name: 'Daftarkan perangkat ini' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Perangkat ini terdaftar' })).toBeVisible();
}

async function typePin(page: Page, pin: string) {
  await page.getByLabel('Digit PIN 1').pressSequentially(pin);
  await page.getByRole('button', { name: 'Masuk dengan PIN' }).click();
}

test.describe('PIN masuk cepat (P02)', () => {
  test('daftar PIN → keluar → masuk dengan PIN → PIN salah 5× dinonaktifkan → wajib login penuh', async ({
    page,
    context,
  }) => {
    const nurse = await createAccount({
      roles: ['perawat'],
      unitName: 'Bangsal Melati E2E',
      displayName: 'Sari Pertiwi, S.Kep',
    });
    await loginAs(page, nurse);
    await registerPin(page, nurse.password);
    const item = page.getByRole('listitem').filter({ hasText: 'Komputer Bangsal Melati E2E' });
    await expect(item).toContainText('perangkat ini');
    await expect(item).toContainText('Perawat · Bangsal Melati E2E');

    // Token perangkat hanya di cookie httpOnly, tidak terbaca skrip dan tidak ada di halaman.
    const pinCookie = (await context.cookies()).find((c) => c.name === 'simrs_pin');
    expect(pinCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('simrs_pin');
    expect(await page.content()).not.toContain(pinCookie?.value.split('.')[3] ?? '-');

    // Keluar: sesi dicabut, cookie PIN milik perangkat tetap.
    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page).toHaveURL(/\/masuk$/);
    expect((await context.cookies()).map((c) => c.name)).toContain('simrs_pin');

    const quick = page.getByRole('region', { name: 'Masuk dengan PIN' });
    await expect(quick).toBeVisible();
    await expect(quick.getByText('Sari Pertiwi, S.Kep')).toBeVisible();
    await expect(quick.getByText('Perawat · Bangsal Melati E2E')).toBeVisible();
    await typePin(page, PIN);
    await expect(page).not.toHaveURL(/\/masuk/);
    await expect(page.getByText('Selamat datang, Sari Pertiwi, S.Kep')).toBeVisible();
    // Sesi PIN terkunci ke posisinya dan tidak bisa mendaftarkan PIN baru.
    await page.getByRole('link', { name: 'PIN masuk cepat' }).first().click();
    await expect(page.getByText('Anda sedang masuk dengan PIN')).toBeVisible();
    await expect(page.getByRole('button', { name: /Daftarkan perangkat ini|Ganti PIN/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page).toHaveURL(/\/masuk$/);
    for (const remaining of [4, 3, 2, 1]) {
      await typePin(page, WRONG);
      await expect(
        page.getByRole('alert').filter({ hasText: `Sisa ${remaining} kali percobaan` }),
      ).toBeVisible();
    }
    await typePin(page, WRONG);
    await expect(page).toHaveURL(/alasan=pin-nonaktif/);
    await expect(page.getByText('PIN di perangkat ini tidak berlaku lagi')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Masuk dengan PIN' })).toHaveCount(0);

    // Login penuh tetap jalan.
    await submitPassword(page, nurse, nurse.password);
    await typeCode(page, totpFor(nurse.totpSecret as string));
    await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
    await expect(page.getByText('Selamat datang, Sari Pertiwi, S.Kep')).toBeVisible();
  });

  test('hapus PIN perangkat dari daftar: layar masuk tidak menawarkan PIN lagi', async ({ page }) => {
    const nurse = await createAccount({ roles: ['bidan'], unitName: 'VK E2E' });
    await loginAs(page, nurse);
    await registerPin(page, nurse.password);
    await page.getByRole('button', { name: 'Hapus PIN di Komputer VK E2E' }).click();
    await expect(page.getByText('Belum ada perangkat ber-PIN yang berlaku.')).toBeVisible();
    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page).toHaveURL(/\/masuk$/);
    await expect(page.getByRole('region', { name: 'Masuk dengan PIN' })).toHaveCount(0);
  });

  test('peran sensitif tidak ditawari PIN; PIN lemah dan sandi salah ditolak dengan jelas', async ({
    page,
  }) => {
    const kasir = await createAccount({ roles: ['kasir'], unitName: 'Kasir E2E' });
    await loginAs(page, kasir);
    await expect(page.getByRole('link', { name: 'PIN masuk cepat' })).toHaveCount(0);
    await page.goto('/akun/pin');
    await expect(page.getByText(/Posisi Kasir tidak bisa memakai PIN masuk cepat/)).toBeVisible();
    await page.getByRole('button', { name: 'Keluar' }).first().click();
    // Tunggu sesi benar-benar dicabut sebelum masuk sebagai akun lain (seperti langkah Keluar lain di berkas ini).
    await expect(page).toHaveURL(/\/masuk$/);

    const nurse = await createAccount({ roles: ['perawat'], unitName: 'Melati E2E' });
    await loginAs(page, nurse);
    await page.goto('/akun/pin');
    await page.getByLabel('PIN baru (6 digit)').fill('123456');
    await page.getByLabel('Ulangi PIN').fill('123456');
    await page.getByLabel('Kata sandi saat ini').fill(nurse.password);
    await page.getByRole('button', { name: 'Daftarkan perangkat ini' }).click();
    await expect(page.getByText('PIN tidak boleh angka berurutan.')).toBeVisible();
    await page.getByLabel('PIN baru (6 digit)').fill(PIN);
    await page.getByLabel('Ulangi PIN').fill(PIN);
    await page.getByLabel('Kata sandi saat ini').fill('bukan sandinya');
    await page.getByRole('button', { name: 'Daftarkan perangkat ini' }).click();
    await expect(page.getByText('Kata sandi saat ini salah.')).toBeVisible();
    await expect(page.getByText('Belum ada perangkat ber-PIN yang berlaku.')).toBeVisible();
  });
});
