import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ConsoleMessage, expect, type Page, test } from '@playwright/test';
import { SCREENS, type ScreenDef } from '../../src/lib/screens';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Jaring pengaman mode presentasi (ADR-0023): SETIAP layar berstatus `demo` di registri terbuka untuk posisi
 * pemakainya tanpa galat halaman, tanpa ajakan "ganti posisi", dan tanpa scroll horizontal (layar staf) atau dengan
 * kanvas perangkat yang termuat (anjungan, TV, tablet, ponsel). Layar baru otomatis ikut teruji.
 *
 * `QA_VISUAL=1` juga menyimpan tangkapan layar 1366×768 dan 1920×1080 (proyek desktop) atau ukuran tablet ke
 * `.local/qa-visual/` di akar repo (tidak ikut terhapus saat Playwright membersihkan `test-results/`) untuk tinjauan
 * visual sebelum presentasi.
 */

/** Rute contoh untuk layar berparameter: kunjungan/persetujuan pasien skenario (`lib/demo/fixtures/pasien.ts`). */
const EXTRA_PATHS: Record<string, readonly string[]> = {
  order: ['/klinis/order/kj-suryo', '/klinis/order/kj-hartono'],
  // Pasien skenario (bisa belum dirawat → halaman penjelasan) dan pasien rawat inap biasa (rekam lengkap).
  ranap: ['/klinis/rawat-inap/kj-hartono', '/klinis/rawat-inap/kj-ratna', '/klinis/rawat-inap/kj-endang'],
  resume: ['/klinis/resume/kj-hartono', '/klinis/resume/kj-ratna'],
  consent: ['/tablet/persetujuan/pk-hartono'],
};
/** Layar yang hanya punya rute berparameter (tanpa halaman indeks). */
const NO_INDEX = new Set(['resume', 'consent']);

function pathsOf(screen: ScreenDef): string[] {
  return [...(NO_INDEX.has(screen.id) ? [] : [screen.route]), ...(EXTRA_PATHS[screen.id] ?? [])];
}

/** Posisi pembuka tiap layar: pemakai pertama di registri ('semua' → perawat). */
function roleOf(screen: ScreenDef): string {
  return screen.demoRoles === 'semua' ? 'perawat' : (screen.demoRoles[0] ?? 'perawat');
}

const demoScreens = SCREENS.filter((s) => s.status === 'demo');
const byRole = new Map<string, ScreenDef[]>();
for (const screen of demoScreens) {
  const role = roleOf(screen);
  byRole.set(role, [...(byRole.get(role) ?? []), screen]);
}

const QA_VISUAL = process.env.QA_VISUAL === '1';
/** `.local/qa-visual/` di akar repo, dihitung dari letak playwright.config.ts (apps/web). */
function qaDir(configFile: string | undefined): string {
  return resolve(
    dirname(configFile ?? join(process.cwd(), 'playwright.config.ts')),
    '..',
    '..',
    '.local',
    'qa-visual',
  );
}

async function checkScreen(page: Page, screen: ScreenDef, path: string): Promise<void> {
  const errors: string[] = [];
  const onError = (err: Error) => errors.push(err.message);
  // Galat konsol menangkap juga hidrasi yang tidak cocok (mis. jam/timer dihitung saat render).
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text());
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  try {
    const res = await page.goto(path);
    expect(res?.status(), `${path}: status HTTP`).toBe(200);
    await expect(page.getByText('Layar ini untuk posisi lain')).toHaveCount(0);
    await expect(page.getByText(/Application error|Terjadi kesalahan/)).toHaveCount(0);
    if (screen.layout === 'perangkat') {
      // Kanvas tetap (ScaleToFit) sudah diskalakan ke jendela.
      await expect(page.locator('[role="region"][data-scale]').first()).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path}: scroll horizontal`).toBeLessThanOrEqual(0);
    }
    expect(errors, `${path}: galat JavaScript`).toEqual([]);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
}

async function capture(page: Page, root: string, project: string, name: string): Promise<void> {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

test.describe('mode presentasi · semua layar', () => {
  test('registri punya layar demo untuk diuji', () => {
    expect(demoScreens.length).toBeGreaterThan(0);
  });

  for (const [role, screens] of byRole) {
    test(`posisi ${role}: ${screens.map((s) => s.id).join(', ')}`, async ({ page }, testInfo) => {
      test.setTimeout(60_000 + screens.length * (QA_VISUAL ? 45_000 : 15_000));
      const account = await createAccount({ roles: [role] });
      await loginAs(page, account);
      for (const screen of screens) {
        for (const path of pathsOf(screen)) {
          await test.step(`${screen.id} ${path}`, async () => {
            await checkScreen(page, screen, path);
            if (!QA_VISUAL) return;
            const slug = `${screen.id}${path.replaceAll('/', '_')}`;
            if (testInfo.project.name === 'demo-desktop') {
              for (const [w, h] of [
                [1366, 768],
                [1920, 1080],
              ] as const) {
                await page.setViewportSize({ width: w, height: h });
                await page.goto(path);
                await page.waitForLoadState('networkidle');
                await capture(page, qaDir(testInfo.config.configFile), `${w}x${h}`, slug);
              }
              await page.setViewportSize({ width: 1280, height: 720 });
            } else {
              await page.waitForLoadState('networkidle');
              await capture(page, qaDir(testInfo.config.configFile), testInfo.project.name, slug);
            }
          });
        }
      }
    });
  }
});
