import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ConsoleMessage, expect, type Page, test, type TestInfo } from '@playwright/test';
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

/**
 * Rute contoh untuk layar berparameter: kunjungan/persetujuan pasien skenario dan pasien biasa
 * (`lib/demo/fixtures/pasien.ts`) yang terbuka untuk akun baru (semua skenario di langkah awal).
 */
const EXTRA_PATHS: Record<string, readonly string[]> = {
  order: ['/klinis/order/kj-suryo', '/klinis/order/kj-rohana'],
  // Pasien skenario (bisa belum dirawat → halaman penjelasan) dan pasien rawat inap biasa (rekam lengkap).
  ranap: ['/klinis/rawat-inap/kj-hartono', '/klinis/rawat-inap/kj-ratna', '/klinis/rawat-inap/kj-endang'],
  resume: ['/klinis/resume/kj-hartono', '/klinis/resume/kj-ratna'],
  consent: ['/tablet/persetujuan/pk-ratna', '/tablet/persetujuan/pk-hendro'],
};
/** Layar yang hanya punya rute berparameter (tanpa halaman indeks). */
const NO_INDEX = new Set(['resume', 'consent']);

/**
 * Rute Tn. Hartono yang baru ada setelah skenario IGD → rawat inap sampai tahapnya: CPOE selama di IGD sejak
 * asesmen dokter, persetujuan tindakan sejak tata laksana (sebelumnya 404).
 */
const IGD_SCENARIO_PATHS: ReadonlyArray<{
  stage: string;
  paths: ReadonlyArray<[screen: string, path: string]>;
}> = [
  { stage: 'Asesmen dokter', paths: [['order', '/klinis/order/kj-hartono']] },
  {
    stage: 'Tata laksana',
    paths: [
      ['order', '/klinis/order/kj-hartono'],
      ['consent', '/tablet/persetujuan/pk-hartono'],
    ],
  },
];

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

/** `QA_VISUAL=1`: tangkapan `path` di 1366×768 + 1920×1080 (proyek desktop) atau ukuran proyek tablet. */
async function captureVisual(page: Page, testInfo: TestInfo, path: string, slug: string): Promise<void> {
  if (!QA_VISUAL) return;
  const root = qaDir(testInfo.config.configFile);
  if (testInfo.project.name === 'demo-desktop') {
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await capture(page, root, `${w}x${h}`, slug);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  } else {
    await page.waitForLoadState('networkidle');
    await capture(page, root, testInfo.project.name, slug);
  }
}

const slugOf = (screenId: string, path: string) => `${screenId}${path.replaceAll('/', '_')}`;

test.describe('mode presentasi · semua layar', () => {
  test('registri punya layar demo untuk diuji', () => {
    expect(demoScreens.length).toBeGreaterThan(0);
  });

  test('posisi dokter: layar Tn. Hartono pada tahap skenario IGD-nya', async ({ page }, testInfo) => {
    const checks = IGD_SCENARIO_PATHS.reduce((n, s) => n + s.paths.length, 0);
    test.setTimeout(60_000 + checks * (QA_VISUAL ? 45_000 : 15_000));
    const account = await createAccount({ roles: ['dokter'] });
    await loginAs(page, account);
    for (const { stage, paths } of IGD_SCENARIO_PATHS) {
      await page.goto('/simulasi');
      await page.getByRole('tab', { name: 'IGD → rawat inap' }).click();
      await page.getByText('Lompat ke tahap', { exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
      await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
      for (const [id, path] of paths) {
        const screen = demoScreens.find((s) => s.id === id);
        expect(screen, `layar ${id} berstatus demo`).toBeDefined();
        if (!screen) continue;
        await test.step(`${stage}: ${id} ${path}`, async () => {
          await checkScreen(page, screen, path);
          // Tahap ikut di nama berkas: rute yang sama bisa tampil berbeda per tahap.
          const stageSlug = stage.toLowerCase().replaceAll(' ', '-');
          await captureVisual(page, testInfo, path, `${slugOf(id, path)}__${stageSlug}`);
        });
      }
    }
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
            await captureVisual(page, testInfo, path, slugOf(screen.id, path));
          });
        }
      }
    });
  }
});
