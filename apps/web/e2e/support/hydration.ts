import { expect, type Locator } from '@playwright/test';

/**
 * Klik tombol klien sampai efeknya (`shows`) tampil. Setelah navigasi dokumen penuh (form GET seperti pencarian layar
 * Akses, atau tautan yang diklik sebelum halaman terhidrasi) HTML server sudah tampil sebelum React terpasang: klik
 * pada saat itu hilang tanpa galat (jejak Playwright: klik 50.147 ms, prefetch RSC pertama sesudah hidrasi 50.351 ms).
 * Hanya untuk aksi idempoten, mis. membuka konfirmasi (`setAsking(true)`); jangan untuk tombol yang mengirim data.
 */
export async function clickUntilShown(button: Locator, shows: Locator): Promise<void> {
  await expect(async () => {
    await button.click();
    await expect(shows).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
