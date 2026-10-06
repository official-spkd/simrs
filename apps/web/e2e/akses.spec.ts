import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs, submitPassword, totpFor, typeCode } from './support/accounts';
import { clickUntilShown } from './support/hydration';

/** Cari pengguna di daftar lalu buka panel detailnya. */
async function openUser(page: Page, username: string) {
  await page.getByLabel('Cari pengguna').fill(username);
  await page.getByRole('button', { name: 'Terapkan' }).click();
  await page.getByRole('link', { name: new RegExp(username) }).click();
  await expect(page).toHaveURL(/pengguna=/);
  await expect(page.getByRole('heading', { name: 'Penugasan', level: 3 })).toBeVisible();
}

test.describe('layar Akses (/sistem/akses)', () => {
  test('admin: KPI, daftar, undang pengguna → pengguna baru login pertama sampai beranda', async ({
    page,
    browser,
  }) => {
    // Dua login penuh (admin + pengguna baru: daftar MFA, ganti sandi) dalam satu tes.
    test.setTimeout(90_000);
    const admin = await createAccount({ roles: ['admin_tenant'], displayName: 'Andi Pratama' });
    // Filter unit butuh pengguna yang pasti ditugaskan di unit itu; unit sendiri agar tidak bergantung pada isi DB tes.
    const unitName = `Bangsal Uji ${admin.id.slice(-6)}`;
    await createAccount({ roles: ['perawat'], displayName: 'Perawat Uji Fiktif', unitName });
    await loginAs(page, admin, '/sistem/akses');
    await expect(page.getByRole('heading', { name: 'Pengguna dan peran', level: 1 })).toBeVisible();
    for (const kpi of ['Pengguna aktif', 'MFA aktif', 'Break-the-glass 7 hari', 'Akun dikunci']) {
      await expect(page.getByText(kpi, { exact: true })).toBeVisible();
    }
    // Mockup Akses: sinkron SDM tampil nonaktif dengan alasannya (modul SDM belum ber-API).
    await expect(page.getByRole('button', { name: 'Sinkron dari data SDM' })).toBeDisabled();
    await expect(page.getByText('Belum tersambung ke modul SDM')).toBeVisible();
    // Aturan kontekstual = status turunan matriks, bukan sakelar (ABAC dan break-the-glass tidak bisa dimatikan).
    const rules = page.getByRole('region', { name: 'Aturan kontekstual' });
    await expect(rules.getByText('Pasien rahasia (VIP, kasus sensitif)')).toBeVisible();
    await expect(rules.getByRole('switch')).toHaveCount(0);
    // Filter unit (mockup Akses) diteruskan ke API (`unitId`): setiap baris punya penugasan di unit itu.
    await page.getByLabel('Unit', { exact: true }).selectOption({ label: unitName });
    await page.getByRole('button', { name: 'Terapkan' }).click();
    await expect(page).toHaveURL(/unit=/);
    const rows = page.getByRole('region', { name: 'Daftar pengguna' }).locator('tbody tr');
    await expect(rows.first()).toContainText(unitName);
    for (const text of await rows.allInnerTexts()) expect(text).toContain(unitName);
    await page.goto('/sistem/akses');

    const username = `undang.${admin.id.slice(-8)}`;
    await page.getByRole('button', { name: '+ Undang pengguna' }).click();
    const dialog = page.getByRole('dialog', { name: 'Undang pengguna' });
    await dialog.getByLabel('NIP atau email RS').fill(username);
    await dialog.getByLabel('Nama tampilan').fill('Rina Wulandari, S.Kep');
    await dialog.getByLabel('Peran').selectOption({ label: 'Perawat' });
    await dialog.getByRole('button', { name: 'Buat akun' }).click();
    const created = page.getByRole('dialog', { name: 'Akun dibuat' });
    await expect(created).toBeVisible();
    const temporary = (await created.getByTestId('sandi-sementara').textContent()) ?? '';
    expect(temporary).toHaveLength(16);
    await created.getByRole('button', { name: 'Selesai' }).click();

    await openUser(page, username);
    await expect(page.getByText('Perawat · Semua unit')).toBeVisible();
    await expect(page.getByText('MFA belum')).toBeVisible();

    // Pengguna baru (sesi browser terpisah): sandi sementara → daftar MFA → sandi baru → beranda.
    const ctx = await browser.newContext();
    const fresh = await ctx.newPage();
    await fresh.goto('/masuk');
    await submitPassword(fresh, { tenantCode: 'RSFA', username }, temporary);
    await fresh.getByRole('button', { name: 'Tampilkan kode QR' }).click();
    const secret = ((await fresh.getByTestId('mfa-secret').textContent()) ?? '').replace(/\s/g, '');
    await typeCode(fresh, totpFor(secret));
    await fresh.getByRole('button', { name: 'Aktifkan dan lanjut' }).click();
    const pass = `kalimat sandi perawat baru ${admin.id.slice(-4)}`;
    await fresh.getByLabel('Kata sandi saat ini').fill(temporary);
    await fresh.getByLabel('Kata sandi baru', { exact: true }).fill(pass);
    await fresh.getByLabel('Ulangi kata sandi baru').fill(pass);
    await fresh.getByRole('button', { name: 'Simpan dan lanjut' }).click();
    await expect(fresh.getByText('Selamat datang, Rina Wulandari, S.Kep')).toBeVisible();
    await ctx.close();
  });

  test('admin: reset sandi menampilkan sandi sementara sekali; nonaktifkan akun', async ({ page }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    const staff = await createAccount({ roles: ['kasir'], displayName: 'Hendra Setiawan' });
    await loginAs(page, admin, '/sistem/akses');
    await openUser(page, staff.username);

    await clickUntilShown(
      page.getByRole('button', { name: 'Reset kata sandi' }),
      page.getByText(/Semua sesi aktifnya dicabut/),
    );
    await page.getByRole('button', { name: 'Ya, lanjutkan' }).click();
    await expect(page.getByTestId('sandi-sementara')).toHaveText(/^.{16}$/);

    await page.getByRole('button', { name: 'Nonaktifkan akun' }).click();
    await page.getByRole('button', { name: 'Ya, lanjutkan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Akun dinonaktifkan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aktifkan kembali' })).toBeVisible();
  });

  test('admin: akun tanpa sandi tampil "Belum diaktifkan" (filter + petunjuk); reset sandi mengaktifkannya', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    const staff = await createAccount({
      roles: ['perawat'],
      displayName: 'Ns. Dewi Seed, S.Kep',
      mfa: false,
      mustChangePassword: true,
      credential: false,
    });
    await loginAs(page, admin, '/sistem/akses');
    await page.getByLabel('Cari pengguna').fill(staff.username);
    await page.getByLabel('Status', { exact: true }).selectOption({ label: 'Belum diaktifkan' });
    await page.getByRole('button', { name: 'Terapkan' }).click();
    const row = page.getByRole('row', { name: new RegExp(staff.username) });
    await expect(row.getByText('Belum diaktifkan')).toBeVisible();
    await row.getByRole('link', { name: new RegExp(staff.username) }).click();
    await expect(page.getByText(/belum punya kata sandi, jadi belum bisa masuk/)).toBeVisible();

    await clickUntilShown(
      page.getByRole('button', { name: 'Reset kata sandi' }),
      page.getByText(/Aktifkan akun Ns\. Dewi Seed, S\.Kep dengan sandi sementara/),
    );
    await page.getByRole('button', { name: 'Ya, lanjutkan' }).click();
    await expect(page.getByTestId('sandi-sementara')).toHaveText(/^.{16}$/);
    await page.reload();
    await expect(page.getByText(/belum punya kata sandi, jadi belum bisa masuk/)).toHaveCount(0);
  });

  test('admin: akun sendiri tanpa tombol aksi; izin kelola akses admin terkunci di matriks', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/akses');
    await openUser(page, admin.username);
    await expect(page.getByText('Ini akun Anda sendiri.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset kata sandi' })).toHaveCount(0);

    const matrix = page.getByRole('complementary', { name: 'Detail pengguna dan peran' });
    await matrix.getByLabel('Peran', { exact: true }).selectOption({ label: 'Admin SIM RS' });
    await expect(matrix.getByRole('button', { name: /^Pengguna & penugasan, Tulis/ })).toHaveCount(0);
    await expect(matrix.getByText('Tulis: Semua').first()).toBeVisible();
  });

  test('admin: ubah matriks peran, simpan, lalu kembalikan', async ({ page }, testInfo) => {
    // Matriks satu peran milik RS bersama: hanya satu proyek yang menyuntingnya agar tidak saling timpa.
    test.skip(testInfo.project.name !== 'desktop', 'cukup sekali');
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/akses');
    const matrix = page.getByRole('complementary', { name: 'Detail pengguna dan peran' });
    await matrix.getByLabel('Peran', { exact: true }).selectOption({ label: 'Akuntan' });
    const cell = matrix.getByRole('button', { name: /^Dokumen & cetak, Cetak:/ });
    await expect(cell).toHaveText('Cetak: —');
    await cell.click();
    await expect(cell).toHaveText('Cetak: Relasi');
    await expect(matrix.getByText('1 perubahan belum disimpan')).toBeVisible();
    await expect(matrix.getByLabel('Peran', { exact: true })).toBeDisabled();
    await matrix.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(
      matrix.getByRole('status').filter({ hasText: '1 perubahan izin tercatat di jejak audit' }),
    ).toBeVisible();
    await expect(matrix.getByRole('button', { name: /^Dokumen & cetak, Cetak:/ })).toHaveText(
      'Cetak: Relasi',
    );

    // Kembalikan: Relasi → Unit → Semua → —
    for (let i = 0; i < 3; i++)
      await matrix.getByRole('button', { name: /^Dokumen & cetak, Cetak:/ }).click();
    await expect(matrix.getByRole('button', { name: /^Dokumen & cetak, Cetak:/ })).toHaveText('Cetak: —');
    await matrix.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect(matrix.getByRole('status').filter({ hasText: 'tercatat di jejak audit' })).toBeVisible();
  });

  test('petugas privasi: bisa melihat daftar, tanpa tombol ubah', async ({ page }) => {
    const privasi = await createAccount({ roles: ['petugas_privasi'] });
    const other = await createAccount({ roles: ['kasir'] });
    await loginAs(page, privasi, '/sistem/akses');
    await expect(page.getByRole('heading', { name: 'Pengguna dan peran', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Undang pengguna' })).toHaveCount(0);
    await openUser(page, other.username);
    await expect(page.getByRole('button', { name: 'Reset kata sandi' })).toHaveCount(0);
    await expect(page.getByText('+ Tambah penugasan')).toHaveCount(0);
  });

  test('perawat: menu tidak ada, halaman menolak dengan jelas', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/sistem/akses');
    await expect(page.getByText('Peran Anda tidak berizin melihat daftar pengguna.')).toBeVisible();
  });
});
