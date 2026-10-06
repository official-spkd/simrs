import { expect, test } from '@playwright/test';
import { SCREENS } from '../../src/lib/screens';
import { createAccount, loginAs } from '../support/accounts';

const ids = new Set([
  'lab',
  'rad',
  'farmasi',
  'ok',
  'kritis',
  'depo',
  'bank-darah',
  'gizi',
  'mikro',
  'diagnostik',
  'integrasi',
  'satusehat',
  'bpjs',
  'kemenkes',
  'perangkat',
  'api-publik',
]);
const roles = new Map<string, string[]>();
for (const s of SCREENS.filter((s) => ids.has(s.id))) {
  const role = s.demoRoles === 'semua' ? 'perawat' : s.demoRoles[0]!;
  roles.set(role, [...(roles.get(role) ?? []), s.route]);
}
for (const [role, routes] of roles)
  test(`akses Penunjang/Integrasi: kontrol bernama dan audit target 44 px · ${role}`, async ({ page }) => {
    const account = await createAccount({ roles: [role] });
    await loginAs(page, account, routes[0]!);
    const smallTargets: { route: string; label: string; width: number; height: number }[] = [];
    for (const route of routes) {
      await page.goto(route);
      const controls = await page.locator('main').evaluate((root) =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            'button,a[href],input:not([type="hidden"]),select,textarea,summary',
          ),
        ).flatMap((el) => {
          const rect = el.getBoundingClientRect();
          if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden') return [];
          const ids = el.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
          const field = el as HTMLInputElement;
          const label =
            el.getAttribute('aria-label') ||
            ids
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' ')
              .trim() ||
            Array.from(field.labels ?? [])
              .map((l) => l.textContent?.trim())
              .join(' ') ||
            el.getAttribute('title') ||
            (el instanceof HTMLInputElement
              ? ['button', 'submit'].includes(el.type)
                ? el.value
                : ''
              : el.textContent?.trim()) ||
            '';
          const target =
            el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)
              ? (field.labels?.[0]?.getBoundingClientRect() ?? rect)
              : rect;
          return [
            {
              tag: el.tagName,
              label,
              width: target.width,
              height: target.height,
              disabled: el.hasAttribute('disabled'),
              reason: el.getAttribute('aria-describedby'),
            },
          ];
        }),
      );
      expect(
        controls.filter((c) => !c.label),
        `${route}: kontrol tanpa nama yang dapat dibaca`,
      ).toEqual([]);
      // Checkbox/radio memakai label klik; field lain memakai elemen kontrolnya sendiri.
      smallTargets.push(
        ...controls
          .filter((c) => !c.disabled && (c.width < 43.5 || c.height < 43.5))
          .map((c) => ({ route, label: c.label.slice(0, 100), width: c.width, height: c.height })),
      );
    }
    await test.info().attach('target-sentuh-penunjang', {
      body: JSON.stringify(smallTargets, null, 2),
      contentType: 'application/json',
    });
    test.info().annotations.push({
      type: 'audit',
      description: `${smallTargets.length} kontrol perlu tinjauan target 44 px; lampiran memuat ukurannya.`,
    });
    expect(smallTargets, 'Kontrol awal Penunjang/Integrasi harus memiliki target minimal 44 px').toEqual([]);
  });
