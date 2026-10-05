import { expect, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { createAccount, inTenant, loginAs, TENANTS } from './support/accounts';
import { TEST_DEVICE_UNIT, useTestDevice } from './support/devices';

/** Unit uji baru di RSFA (nama unik) agar perangkat terikat unit yang pasti ada. */
async function createUnit(): Promise<string> {
  const facilityId = newId();
  const id = newId();
  const suffix = id.slice(-6).toUpperCase();
  const name = `Lobi E2E ${suffix}`;
  await inTenant(TENANTS.RSFA, async (tx) => {
    await tx.facility.create({
      data: { id: facilityId, tenantId: TENANTS.RSFA, code: `FE${suffix}`, name: 'Gedung E2E' },
    });
    await tx.unit.create({
      data: { id, tenantId: TENANTS.RSFA, facilityId, code: `LE${suffix}`, name, kind: 'administrasi' },
    });
  });
  return name;
}

test.describe('prinsipal perangkat anjungan/TV (ADR-0027)', () => {
  test('admin mendaftarkan TV → TV memakai kode tanpa login staf → layar display terbuka; dicabut → harus daftar ulang', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const unitName = await createUnit();
    const admin = await createAccount({ roles: ['admin_tenant'], displayName: 'Andi Pratama' });
    await loginAs(page, admin, '/sistem/akses');
    await page.getByRole('link', { name: 'Perangkat anjungan dan display' }).click();
    await expect(
      page.getByRole('heading', { name: 'Perangkat anjungan dan display', level: 1 }),
    ).toBeVisible();

    const deviceName = `TV ruang tunggu ${unitName.slice(-6)}`;
    await page.getByLabel('Jenis').selectOption({ label: 'Display antrean (TV)' });
    await page.getByLabel('Nama perangkat').fill(deviceName);
    await page.getByLabel('Unit').selectOption({ label: unitName });
    await page.getByRole('button', { name: 'Buat kode pendaftaran' }).click();
    const code = (await page.getByTestId('kode-pendaftaran').textContent()) ?? '';
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    const row = page.getByRole('row', { name: new RegExp(deviceName) });
    await expect(row.getByText('Menunggu pendaftaran')).toBeVisible();

    // Perangkat TV: peramban terpisah, tanpa akun staf.
    const tv = await browser.newContext();
    const screen = await tv.newPage();
    await screen.goto('/display/antrean');
    await expect(screen).toHaveURL(/\/perangkat\/daftar\?lanjut=%2Fdisplay%2Fantrean/);
    await screen.getByLabel('Kode RS').fill('RSFA');
    await screen.getByLabel('Kode pendaftaran perangkat').fill(code.toLowerCase());
    await screen.getByRole('button', { name: 'Daftarkan perangkat ini' }).click();
    await expect(screen).toHaveURL(/\/display\/antrean$/);
    await expect(screen.getByRole('heading', { name: 'Display antrean', level: 1 })).toBeVisible();
    await expect(screen.getByTestId('nama-perangkat')).toHaveText(deviceName);
    await expect(screen.getByText(unitName)).toBeVisible();
    const cookies = await tv.cookies();
    const device = cookies.find((c) => c.name.endsWith('simrs_device'));
    expect(device?.httpOnly).toBe(true);
    expect(device?.value).toMatch(/^dv1\./);
    // Kode sekali pakai: tidak bisa dipakai perangkat lain.
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto('/perangkat/daftar');
    await second.getByLabel('Kode RS').fill('RSFA');
    await second.getByLabel('Kode pendaftaran perangkat').fill(code);
    await second.getByRole('button', { name: 'Daftarkan perangkat ini' }).click();
    await expect(
      second.getByText('Kode pendaftaran salah atau sudah kedaluwarsa', { exact: false }),
    ).toBeVisible();
    await other.close();
    // TV yang sama membuka anjungan: perangkat untuk layar lain, bukan data anjungan.
    await screen.goto('/kiosk');
    await expect(screen.getByText('Perangkat untuk layar lain')).toBeVisible();

    // Admin mencabut → TV kembali ke pendaftaran.
    await page.reload();
    await expect(row.getByText('Aktif')).toBeVisible();
    await row.getByRole('button', { name: `Cabut ${deviceName}` }).click();
    await row.getByRole('button', { name: 'Cabut perangkat' }).click();
    await expect(row.getByText('Dicabut', { exact: true })).toBeVisible();
    await screen.goto('/display/antrean');
    await expect(screen).toHaveURL(/\/perangkat\/daftar/);
    await tv.close();
  });

  test('perangkat uji global setup: anjungan membuka /kiosk tanpa akun staf, tetapi tidak membuka layar staf', async ({
    browser,
  }) => {
    const kiosk = await browser.newContext();
    await useTestDevice(kiosk, 'kiosk');
    const page = await kiosk.newPage();
    await page.goto('/kiosk');
    // Anjungan tersambung ke API (potongan 6): layar awal anjungan + identitas perangkat untuk petugas pemasang.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Apa yang ingin Anda lakukan?');
    await expect(page.getByTestId('nama-perangkat')).toContainText(TEST_DEVICE_UNIT);
    // Cookie perangkat bukan sesi staf: layar staf tetap meminta login.
    await page.goto('/sistem/akses');
    await expect(page).toHaveURL(/\/masuk/);
    await kiosk.close();
  });
});
