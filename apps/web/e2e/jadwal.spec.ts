import { expect, test } from '@playwright/test';
import { isoDateJakarta } from '@simrs/shared';
import { dayLong } from '../src/lib/front-office';
import { addDaysIso, mondayOf } from '../src/lib/jadwal-api';
import { createAccount, loginAs } from './support/accounts';
import { E2E_MOCK_URL } from './support/slot';
import { hfisUpdateMessages, sessionQuota } from './support/schedule';

/**
 * F01 · Layar Jadwal dokter mode api (fase 2 potongan 2): petugas pendaftaran mengubah kuota satu sesi (disimpan
 * berversi di API) lalu mengirim jadwal ke HFIS (outbox → worker → mock BPJS). Dokter hanya melihat; kasir ditolak.
 */

// Minggu depan: semua sesinya masih bisa diubah, apa pun jam tes berjalan.
const weekStart = addDaysIso(mondayOf(isoDateJakarta(new Date())), 7);
const tuesday = addDaysIso(weekStart, 1);

// Data jadwal RSFA (front office seed + sesi 30 hari) disiapkan sekali di `global-setup.ts`.

test.describe('layar Jadwal dokter (/jadwal)', () => {
  test('petugas pendaftaran: ubah kuota sesi lalu kirim jadwal ke HFIS', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Satu proyek saja: kuota sesi RSFA dan HFIS mock dipakai bersama.',
    );
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, `/jadwal?minggu=${weekStart}`);
    await expect(page.getByRole('heading', { name: /^Jadwal praktik/, level: 1 })).toBeVisible();

    const before = await sessionQuota('dr. Andini', tuesday);
    await page
      .getByRole('button', { name: new RegExp(`^dr\\. Andini Prameswari, Sp\\.PD, ${dayLong(tuesday)}`) })
      .click();
    const detail = page.getByRole('region', { name: 'Detail slot jadwal' });
    await expect(detail).toContainText('dr. Andini Prameswari, Sp.PD');
    await detail.getByRole('button', { name: 'Tambah kuota JKN' }).click();
    await page.getByRole('button', { name: 'Simpan kuota' }).click();
    await expect(page.getByText(/^Kuota tersimpan/)).toBeVisible();
    await expect
      .poll(async () => (await sessionQuota('dr. Andini', tuesday)).quotaJkn)
      .toBe(before.quotaJkn + 1);

    const since = new Date(Date.now() - 1000);
    await page.getByRole('button', { name: 'Perbarui jadwal ke HFIS' }).click();
    await expect(page.getByText(/jadwal dokter diantrekan ke HFIS/)).toBeVisible();
    await expect
      .poll(async () => (await hfisUpdateMessages(since)).map((m) => m.status).sort(), { timeout: 20_000 })
      .toEqual(['sent', 'sent', 'sent', 'sent', 'sent', 'sent']);
    const mockBpjs = (await (await fetch(`${E2E_MOCK_URL}/_panel/api/bpjs`)).json()) as {
      hfis: { updates: Array<{ kodedokter: number }> };
    };
    expect(mockBpjs.hfis.updates.map((u) => u.kodedokter)).toEqual(
      expect.arrayContaining([99001, 99002, 99003, 99004, 99005, 99006]),
    );
  });

  test('dokter hanya melihat (tanpa simpan/cuti/HFIS); kasir ditolak', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, `/jadwal?minggu=${weekStart}`);
    await expect(page.getByRole('heading', { name: /^Jadwal praktik/, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Catat cuti atau pengganti' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tarik dari HFIS' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Perbarui jadwal ke HFIS' })).toHaveCount(0);
    await expect(
      page.getByText('Pengiriman ke HFIS dilakukan petugas pendaftaran atau admin.'),
    ).toBeVisible();

    await page.context().clearCookies();
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/jadwal');
    await expect(page.getByText(/Akses ditolak|tidak berizin|tidak memakai layar/i).first()).toBeVisible();
  });
});
