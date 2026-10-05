import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { createPrismaClient } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { createAccount, loginAs, TENANTS } from './support/accounts';
import { registerBoundTestDisplay, useDeviceToken, useTestDevice } from './support/devices';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * QA visual layar fase 2 mode api (potongan 9), hanya bila `QA_VISUAL=1` (selain itu dilewati): tangkapan Jadwal,
 * Kendali antrean, Pendaftaran (petugas pendaftaran), anjungan (perangkat anjungan), dan TV antrean (perangkat display
 * terikat) di 1366×768 dan 1920×1080 ke `.local/qa-visual/api-<lebar>x<tinggi>/` di akar repo, sama dengan tangkapan
 * mode presentasi `e2e/demo/semua-layar.spec.ts`. Setiap layar juga diperiksa: tanpa galat JavaScript, layar staf
 * tanpa scroll horizontal.
 */

const QA_VISUAL = process.env.QA_VISUAL === '1';
const SIZES = [
  [1366, 768],
  [1920, 1080],
] as const;

function qaDir(info: TestInfo, size: string): string {
  const configFile = info.config.configFile ?? join(process.cwd(), 'playwright.config.ts');
  const dir = resolve(dirname(configFile), '..', '..', '.local', 'qa-visual', `api-${size}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function shoot(page: Page, info: TestInfo, path: string, slug: string, staff: boolean): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Favicon belum ada (404 dari browser, bukan galat layar).
    if (m.type() === 'error' && !`${m.text()} ${m.location().url}`.includes('favicon')) errors.push(m.text());
  });
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    const res = await page.goto(path);
    expect(res?.status(), `${path}: status HTTP`).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Application error|Terjadi kesalahan/)).toHaveCount(0);
    if (staff) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} @${w}: scroll horizontal`).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: join(qaDir(info, `${w}x${h}`), `${slug}.png`), fullPage: true });
  }
  expect(errors, `${path}: galat JavaScript`).toEqual([]);
}

test.describe('QA visual fase 2 (mode api)', () => {
  test.skip(!QA_VISUAL, 'Hanya dengan QA_VISUAL=1');

  test.beforeAll(async () => {
    await ensureRsfaSchedule();
  });

  test('layar staf: Jadwal, Kendali antrean, Pendaftaran', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tangkapan desktop saja');
    test.setTimeout(120_000);
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, '/antrean');
    await shoot(page, info, '/jadwal', 'jadwal', true);
    await shoot(page, info, '/antrean', 'kendali', true);
    await shoot(page, info, '/pendaftaran', 'pendaftaran', true);
  });

  test('layar perangkat: anjungan dan TV antrean', async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tangkapan desktop saja');
    test.setTimeout(120_000);
    const kioskContext = await browser.newContext();
    await useTestDevice(kioskContext, 'kiosk');
    await shoot(await kioskContext.newPage(), info, '/kiosk', 'anjungan', false);
    await kioskContext.close();

    const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
    let tvToken: string;
    try {
      tvToken = await registerBoundTestDisplay(owner, TENANTS.RSFA, 'RJ-LT2');
    } finally {
      await owner.$disconnect();
    }
    const tvContext = await browser.newContext();
    await useDeviceToken(tvContext, tvToken);
    await shoot(await tvContext.newPage(), info, '/display/antrean', 'tv-antrean', false);
    await tvContext.close();
  });
});
