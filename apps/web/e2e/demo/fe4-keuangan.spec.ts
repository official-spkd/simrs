import { expect, type Locator, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Keuangan lanjutan (mode presentasi, ADR-0023; tanpa mockup): tarif, charge capture, piutang, workbench koder,
 * jasa pelayanan, kas & bank, hutang usaha, costing, dan celah fase 6 di Pembayaran digital.
 */

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Setiap jurnal berpasangan yang tampil seimbang (data-total-debit = data-total-credit). */
async function journalsBalanced(scope: Locator | Page, min = 1) {
  const pairs = await scope
    .locator('figure:has([data-total-debit])')
    .evaluateAll((figs) =>
      figs.map((f) => [
        f.querySelector('[data-total-debit]')?.getAttribute('data-total-debit') ?? 'x',
        f.querySelector('[data-total-credit]')?.getAttribute('data-total-credit') ?? 'y',
      ]),
    );
  expect(pairs.length).toBeGreaterThanOrEqual(min);
  for (const [d, c] of pairs) expect(d).toBe(c);
}

test.describe('tarif dan paket (U01)', () => {
  test('akuntan mengajukan usulan; retroaktif ditolak; tidak bisa menyetujui sendiri', async ({ page }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/tarif');
    await page.goto('/keuangan/tarif');
    await expect(
      page.getByRole('heading', { name: 'Tarif & paket · master tarif berversi', level: 1 }),
    ).toBeVisible();

    const list = page.getByRole('region', { name: 'Daftar tarif' });
    await list.getByLabel('Cari item tarif').fill('kateter');
    await list.getByRole('button', { name: /Pemasangan kateter urin/ }).click();
    const detail = page.getByRole('region', { name: 'Rincian tarif' });
    await expect(detail.getByRole('heading', { name: 'Pemasangan kateter urin' })).toBeVisible();
    await detail.getByRole('button', { name: 'Buat usulan perubahan' }).click();

    const form = page.getByRole('form', { name: 'Usulan perubahan tarif' });
    const submit = form.getByRole('button', { name: 'Ajukan usulan' });
    await form.getByLabel('Kelas 2 (Rp)').fill('80.000');
    await form.getByLabel('Berlaku mulai').fill('2026-10-05');
    await form.getByLabel('Alasan perubahan (wajib)').fill('Harga kateter silikon naik dari pemasok');
    await expect(submit).toBeDisabled();
    await expect(form.getByText(/tidak retroaktif/).last()).toBeVisible();
    await form.getByLabel('Berlaku mulai').fill('2026-11-01');
    await form.getByLabel('Kelas 1 (Rp)').fill('85.000');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByText(/Usulan UT-2610-008 diajukan · \w{3}, 5 Okt 2026 · \d{2}\.\d{2}/),
    ).toBeVisible();

    await page.getByRole('tab', { name: /Usulan perubahan/ }).click();
    const usulan = page.getByRole('listitem', { name: /UT-2610-008/ });
    await expect(usulan.getByRole('button', { name: 'Setujui usulan' })).toBeDisabled();
    await expect(usulan.getByText(/posisi manajemen/)).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('manajemen menyetujui usulan → versi baru terjadwal; paket lebih murah dari item', async ({
    page,
  }) => {
    const direktur = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direktur, '/keuangan/tarif');
    await page.goto('/keuangan/tarif');
    await page.getByRole('tab', { name: /Usulan perubahan/ }).click();
    const usg = page.getByRole('listitem', { name: /UT-2610-007/ });
    await usg.getByRole('button', { name: 'Setujui usulan' }).click();
    await expect(
      page.getByText(/UT-2610-007 disetujui · \d{2}\.\d{2} · USG abdomen versi baru terjadwal/),
    ).toBeVisible();
    await expect(usg.getByText(/✓ Disetujui/)).toBeVisible();

    const neb = page.getByRole('listitem', { name: /UT-2610-006/ });
    await neb.getByRole('button', { name: 'Tolak…' }).click();
    const reject = neb.getByRole('button', { name: 'Tolak usulan' });
    await expect(reject).toBeDisabled();
    await neb.getByLabel(/Alasan penolakan/).fill('Tunggu hasil costing nebulizer bulan depan');
    await reject.click();
    await expect(neb.getByText(/✗ Ditolak/)).toBeVisible();

    await page.getByRole('tab', { name: 'Paket' }).click();
    const isi = page.getByRole('region', { name: 'Isi paket' });
    const itemized = BigInt((await isi.locator('[data-itemized]').getAttribute('data-itemized')) ?? '0');
    const price = BigInt(
      (await isi.locator('[data-package-price]').getAttribute('data-package-price')) ?? '0',
    );
    expect(price).toBeLessThan(itemized);
    await isi.getByRole('radio', { name: 'VIP' }).click();
    await expect(isi.locator('[data-package-price]')).toHaveText('Rp 18.200.000');
    await noHorizontalOverflow(page);
  });
});

test.describe('charge capture (U02)', () => {
  test('coba ulang setelah tarif disetujui, reprice penjamin, batal manual beralasan', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/charge-capture');
    await page.goto('/keuangan/charge-capture');
    await expect(
      page.getByRole('heading', { name: /Charge capture · event klinis/, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/17 event = 10 tertagih \+ 4 tertahan \+ 3 pembalik/)).toBeVisible();

    const feed = page.getByRole('region', { name: 'Aliran event klinis' });
    await feed
      .getByRole('group', { name: 'Filter status' })
      .getByRole('button', { name: 'Tertahan' })
      .click();
    const sutan = feed.getByRole('listitem', { name: /Tn\. Sutan Batubara Visite dokter subspesialis/ });
    await sutan.getByRole('button', { name: 'Coba ulang capture' }).click();
    await expect(
      page.getByText(
        /Visite dokter subspesialis VIP Rp 400\.000 masuk tagihan Tn\. Sutan Batubara · \d{2}\.\d{2}/,
      ),
    ).toBeVisible();

    const pct = feed.getByRole('listitem', { name: /prokalsitonin/ });
    await expect(pct.getByRole('button', { name: 'Coba ulang capture' })).toBeDisabled();
    await expect(pct.getByText('Tarif belum disetujui; minta tarif ke pengelola tarif dulu.')).toBeVisible();

    const fr = feed.getByRole('listitem', { name: /Fransiska/ });
    await fr.getByRole('button', { name: 'Reprice baris terbuka' }).click();
    await expect(page.getByText(/Rp 105\.000 masuk tagihan Ny\. Fransiska/)).toBeVisible();
    await expect(page.getByText(/17 event = 12 tertagih \+ 2 tertahan/)).toBeVisible();

    await feed.getByRole('group', { name: 'Filter status' }).getByRole('button', { name: 'Manual' }).click();
    const manual = feed.getByRole('listitem', { name: /Item manual kasir/ });
    await manual.getByRole('button', { name: 'Batalkan baris manual…' }).click();
    const batal = manual.getByRole('button', { name: 'Batalkan baris' });
    await expect(batal).toBeDisabled();
    await manual.getByLabel(/Alasan pembatalan/).fill('Kursi roda milik keluarga, bukan sewa RS');
    await batal.click();
    await expect(
      page.getByText(/Baris manual Sewa kursi roda dibatalkan dengan baris pembalik/),
    ).toBeVisible();
    await expect(feed.locator('[data-line-amount="-25000"]')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

export { journalsBalanced };
