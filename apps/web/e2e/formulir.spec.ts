import { expect, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { createAccount, createFormCorrection, loginAs } from './support/accounts';

test.describe('pembuat formulir (/sistem/formulir)', () => {
  test('komite RM: formulir baru → label wajib → skor + aturan → ajukan → terbitkan → draf v2', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const code = `e2e_${newId().slice(-10).replace(/-/g, '')}`;
    const rm = await createAccount({ roles: ['petugas_rm'], displayName: 'Lestari Ayu' });
    await loginAs(page, rm, '/sistem/formulir');
    await expect(page.getByRole('heading', { name: 'Formulir klinis', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Formulir klinis' }).first()).toBeVisible();

    const create = page.getByRole('complementary', { name: 'Formulir baru' });
    await create.getByLabel('Kode formulir').fill(code);
    await create.getByLabel('Judul').fill('Skrining nyeri E2E');
    await create.getByRole('button', { name: 'Buat draf formulir' }).click();
    await expect(page).toHaveURL(new RegExp(`/sistem/formulir/${code}$`));
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText('Skrining nyeri E2E');
    await expect(h1).toContainText('Draf v1');

    // Field pilihan baru; label dikosongkan → belum bisa diajukan, field bermasalah dipilih.
    await page.getByRole('button', { name: 'Tambah field Pilihan tunggal ke kanvas' }).click();
    const props = page.getByRole('region', { name: 'Properti field terpilih' });
    await props.getByLabel('Label', { exact: true }).fill('');
    await expect(props.getByText('Label wajib diisi sebelum formulir diajukan.')).toBeVisible();
    await page.getByRole('button', { name: 'Ajukan persetujuan komite' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Belum bisa diajukan' })).toContainText(
      '1 field belum berlabel',
    );

    await props.getByLabel('Label', { exact: true }).fill('Ada nyeri?');
    await props.getByLabel('Label opsi 1').fill('Ya');
    await props.getByLabel('Skor opsi 1').fill('10');
    await props.getByLabel('Label opsi 2').fill('Tidak');
    await props.getByLabel('Skor opsi 2').fill('0');

    // Field skor + kategori + aturan; pratinjau skor dari pilihan di kanvas.
    await page.getByRole('button', { name: 'Tambah field Skor terhitung ke kanvas' }).click();
    await props.getByLabel('Label', { exact: true }).fill('Skor nyeri');
    await props.getByRole('button', { name: 'Atur kategori skor' }).click();
    await props.getByRole('button', { name: 'Tambah kategori' }).click();
    await props.getByLabel('Batas bawah kategori 2').fill('10');
    await props.getByLabel('Label kategori 2').fill('Risiko tinggi');
    await props.getByLabel('Aturan tindak lanjut').fill('Skor ≥ 10 → kaji nyeri lanjutan');

    const canvas = page.getByRole('region', { name: 'Kanvas formulir' });
    await expect(canvas.getByText('0–9 rendah · ≥ 10 tinggi')).toBeVisible();
    await canvas.getByRole('button', { name: /^Ya\s*\+10$/ }).click();
    await expect(canvas.getByText('1 dari 1 pertanyaan terjawab')).toBeVisible();
    await expect(canvas.getByText('Aturan aktif: Skor ≥ 10 → kaji nyeri lanjutan')).toBeVisible();

    await page.getByRole('button', { name: 'Simpan draf' }).click();
    await expect(page.getByText('Semua perubahan tersimpan')).toBeVisible();

    await page.getByRole('button', { name: 'Ajukan persetujuan komite' }).click();
    await expect(h1).toContainText('Diajukan v1');
    await expect(page.getByText(/^Diajukan ke Komite RM .* oleh Lestari Ayu$/)).toBeVisible();

    await page.getByRole('button', { name: 'Terbitkan v1' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'v1 diterbitkan pukul' })).toContainText(
      'entri lama tetap ditampilkan dengan versi saat diisi',
    );
    await expect(h1).toContainText('Berlaku v1');

    await page.getByRole('button', { name: 'Buat draf v2' }).click();
    await expect(h1).toContainText('Draf v2');
    const history = page.getByRole('region', { name: 'Riwayat versi' });
    await expect(history.getByRole('listitem').nth(0)).toContainText('v2 · draf');
    await expect(history.getByRole('listitem').nth(1)).toContainText('Berlaku');
    // Field dari versi berlaku tidak bisa dihapus (kuncinya tetap antar versi).
    await canvas.getByRole('button', { name: /^Ada nyeri\?/ }).click();
    await expect(props.getByText(/tetap antar versi/)).toBeVisible();
    await expect(props.getByRole('button', { name: 'Hapus field dari kanvas' })).toHaveCount(0);

    await page.goto('/sistem/formulir');
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toContainText('v1');
    await expect(row).toContainText('Draf v2');
  });

  test('perawat: menu Formulir klinis tidak tampil; pustaka hanya bisa dibaca', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/sistem/formulir');
    await expect(page.getByRole('heading', { name: 'Formulir klinis', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Formulir klinis' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Formulir baru' })).toHaveCount(0);
  });
});

test.describe('diff koreksi isian di Audit', () => {
  test('petugas privasi: Versi 1 → versi 2 dengan alasan, nilai lama/baru, penulis asli, pengoreksi', async ({
    page,
  }) => {
    const author = await createAccount({ roles: ['perawat'], displayName: 'Rina Wulandari, S.Kep' });
    const corrector = await createAccount({ roles: ['perawat'], displayName: 'Dewi Kartika, S.Kep' });
    const reason = `Salah pilih alat bantu saat entri ${author.id.slice(-6)}`;
    const { seq } = await createFormCorrection(author, corrector, reason);
    const privasi = await createAccount({ roles: ['petugas_privasi'] });
    await loginAs(page, privasi, `/sistem/audit?kejadian=${seq}`);

    const detail = page.getByRole('complementary', { name: 'Detail' });
    await expect(detail.getByRole('heading', { name: 'Versi 1 → versi 2' })).toBeVisible();
    await expect(detail.getByText(/^Detail koreksi · Asesmen risiko jatuh dewasa \(Morse\)/)).toBeVisible();
    await expect(detail.getByText('ALASAN KOREKSI (WAJIB)')).toBeVisible();
    await expect(detail.getByText(reason)).toBeVisible();
    await expect(detail.getByText('− v1 Alat bantu berjalan: Berpegangan pada furnitur')).toBeVisible();
    await expect(detail.getByText('+ v2 Alat bantu berjalan: Kruk / tongkat / walker')).toBeVisible();
    await expect(detail.getByText('Rina Wulandari, S.Kep')).toBeVisible();
    await expect(detail.getByText('Dewi Kartika, S.Kep')).toBeVisible();
    await expect(detail.getByText(/Versi 1 tetap tersimpan dan dapat dibuka/)).toBeVisible();
  });
});
