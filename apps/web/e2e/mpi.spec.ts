import { expect, test } from '@playwright/test';
import { createAccount, createDuplicatePair, loginAs } from './support/accounts';

test.describe('layar MPI (/rekam-medis/mpi)', () => {
  test('petugas RM: banding, ambil nama dari B, gabung beralasan, lalu batalkan', async ({ page }) => {
    const pair = await createDuplicatePair();
    const rm = await createAccount({ roles: ['petugas_rm'], displayName: 'Lestari Ayu' });
    await loginAs(page, rm, `/rekam-medis/mpi?pasangan=${pair.candidateId}`);

    await expect(
      page.getByRole('heading', { name: 'Kemungkinan rekam medis ganda', level: 1 }),
    ).toBeVisible();
    const queue = page.getByRole('region', { name: 'Antrean tinjauan' });
    await expect(queue.locator('a[aria-current="true"]')).toContainText('Siti Rahmawati / Siti Rachmawati');

    const table = page.getByRole('table', { name: 'Perbandingan atribut rekam medis A dan B' });
    await expect(table.getByRole('columnheader', { name: new RegExp(pair.a.mrn) })).toBeVisible();
    // NIK hanya di A, BPJS hanya di B → BPJS otomatis diambil dari B.
    await expect(page.getByText('Diambil dari B: No. peserta BPJS.')).toBeVisible();
    const nameB = table.getByRole('button', { name: /^Nama dari B: Siti Rachmawati/ });
    await expect(nameB).toHaveAttribute('aria-pressed', 'false');
    await nameB.click();
    await expect(nameB).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Diambil dari B: Nama, No. peserta BPJS.')).toBeVisible();

    const merge = page.getByRole('button', { name: `Gabungkan ke ${pair.a.mrn}` });
    await expect(merge).toBeDisabled();
    await page.getByLabel(/Alasan keputusan/).fill('Dikonfirmasi dengan KTP dan wawancara pasien di loket');
    await merge.click();

    const status = page.getByRole('status').filter({ hasText: 'Berhasil digabung' });
    await expect(status).toBeVisible();
    await expect(status).toContainText(`RM ${pair.b.mrn} kini dialihkan ke ${pair.a.mrn}.`);
    await expect(status).toContainText('Diambil dari B: Nama, No. peserta BPJS.');
    await expect(queue.locator('a[aria-current="true"]')).toContainText('Digabung');

    const undo = status.getByRole('button', { name: 'Batalkan keputusan' });
    await expect(undo).toBeDisabled();
    await status.getByLabel(/Alasan pembatalan/).fill('Ternyata dua orang berbeda setelah dicek ulang KTP');
    await undo.click();
    await expect(page.getByRole('button', { name: `Gabungkan ke ${pair.a.mrn}` })).toBeVisible();
    await expect(page.getByText(/Penggabungan sebelumnya dibatalkan/)).toBeVisible();
  });

  test('bukan orang yang sama, lalu keputusan dibatalkan', async ({ page }) => {
    const pair = await createDuplicatePair();
    const rm = await createAccount({ roles: ['petugas_rm'] });
    await loginAs(page, rm, `/rekam-medis/mpi?pasangan=${pair.candidateId}`);
    await page.getByLabel(/Alasan keputusan/).fill('Kakak beradik kembar, dikonfirmasi keluarga');
    await page.getByRole('button', { name: 'Bukan orang yang sama' }).click();
    const status = page.getByRole('status').filter({ hasText: 'Ditandai bukan orang yang sama' });
    await expect(status).toBeVisible();
    await expect(status).toContainText('Alasan: Kakak beradik kembar, dikonfirmasi keluarga');

    await status.getByLabel(/Alasan pembatalan/).fill('Keputusan keliru, perlu dicek ulang');
    await status.getByRole('button', { name: 'Batalkan keputusan' }).click();
    await expect(page.getByRole('button', { name: 'Bukan orang yang sama' })).toBeVisible();
  });

  test('perawat: menu Rekam medis tidak tampil, halaman menolak', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/rekam-medis/mpi');
    await expect(page.getByText('Tinjauan rekam medis ganda khusus petugas rekam medis.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rekam medis' })).toHaveCount(0);
  });
});
