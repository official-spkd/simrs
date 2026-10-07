import { expect, test } from '@playwright/test';
import { SCREENS } from '../src/lib/screens';
import { createAccount, loginAs } from './support/accounts';

/**
 * Fase 4 potongan 4.0c · layar penunjang hibrida di mode api (pola 3.0d klinis): peran pelaksana yang memegang izin
 * layar (matriks bawaan 4.0a) melihat "Belum tersambung", bukan 404 dan bukan data presentasi; peran tanpa izin
 * melihat "Akses ditolak". Jalur api tiap layar diisi potongan 4.2–4.9; yang sudah tersambung (`CONNECTED`) membuka
 * layar api tanpa "Belum tersambung".
 */

/** Layar penunjang yang sudah tersambung API: Bank darah + Gizi (4.9, `gizi-bank-darah-api.spec.ts`). */
const CONNECTED = new Set(['bank-darah', 'gizi']);

const PERFORMERS: ReadonlyArray<{ role: string; screens: readonly string[] }> = [
  { role: 'analis_lab', screens: ['lab', 'mikro', 'bank-darah', 'kritis'] },
  { role: 'radiografer', screens: ['rad'] },
  { role: 'apoteker', screens: ['farmasi', 'depo'] },
  { role: 'perawat', screens: ['ok'] },
  { role: 'ahli_gizi', screens: ['gizi'] },
  { role: 'dokter', screens: ['diagnostik'] },
];

test.describe('layar penunjang hibrida di mode api (4.0c)', () => {
  test('pelaksana berizin melihat "Belum tersambung" (atau layar api); peran lain "Akses ditolak"', async ({
    page,
  }) => {
    const support = SCREENS.filter((s) => s.phase === 4 && s.permission);
    expect(support.map((s) => s.id).sort()).toEqual(
      PERFORMERS.flatMap((p) => p.screens).sort((a, b) => a.localeCompare(b)),
    );
    for (const { role, screens } of PERFORMERS) {
      await page.context().clearCookies();
      await loginAs(page, await createAccount({ roles: [role] }));
      for (const id of screens) {
        const s = support.find((x) => x.id === id);
        if (!s) throw new Error(`layar ${id} tidak ada`);
        const res = await page.goto(s.route);
        expect(res?.status(), `${role} ${s.route}`).toBe(200);
        await expect(page.getByRole('heading', { name: s.label, level: 1 })).toBeVisible();
        await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(
          CONNECTED.has(id) ? 0 : 1,
        );
        await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
      }
    }
    // Kasir tidak memegang izin penunjang mana pun.
    await page.context().clearCookies();
    await loginAs(page, await createAccount({ roles: ['kasir'] }));
    for (const s of support) {
      await page.goto(s.route);
      await expect(page.getByText('Akses ditolak'), s.route).toBeVisible();
    }
  });
});
