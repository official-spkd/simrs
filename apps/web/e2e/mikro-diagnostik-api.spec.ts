import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import { admitPatient, createStaff, createWard, type Inpatient } from './support/inpatient';

/**
 * Fase 4 · 4.8 · layar Mikrobiologi & PA (S02) dan Diagnostik lain (S10) mode api (ADR-0120). Kultur: analis mencatat
 * isolat awal + validasi teknis → dokter Lab merilis ber-TTE. S10: order EKG → dokter mengisi formulir + kesimpulan →
 * TTE. Pasien diadmisi lewat API sungguhan; order dibuat langsung di DB uji. Data fiktif.
 */

const contexts: BrowserContext[] = [];
const consoleErrors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) {
      consoleErrors.push(`${acc.displayName}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`${acc.displayName}: ${e.message}`));
  await loginAs(page, acc, path);
  await page.goto(path);
  return page;
}

test.afterEach(async () => {
  const errors = consoleErrors.splice(0);
  for (const ctx of contexts.splice(0)) await ctx.close();
  expect(errors).toEqual([]);
});

const status = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

/** Order `orderableName` untuk pasien; bila `labBy`, order lab diterima unit Lab oleh analis itu. */
async function order(p: Inpatient, dpjp: Account, orderableName: string, labBy?: Account) {
  return inTenant(TENANTS.RSFA, async (tx) => {
    const group = await tx.orderGroup.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        encounterId: p.encounterId,
        patientId: p.patientId,
        idempotencyKey: newId(),
        requestHash: 'c'.repeat(64),
        orderedBy: dpjp.id,
        orderedRole: 'dokter',
      },
    });
    const orderable = await tx.orderable.findFirstOrThrow({ where: { name: orderableName } });
    const sr = await tx.serviceRequest.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        orderGroupId: group.id,
        encounterId: p.encounterId,
        patientId: p.patientId,
        orderableId: orderable.id,
        name: orderable.name,
        codeSystem: orderable.codeSystem,
        code: orderable.code,
        priority: 'rutin',
      },
    });
    if (!labBy) return { serviceRequestId: sr.id, labNo: null };
    const lab = await tx.unit.findFirstOrThrow({ where: { code: 'LAB' } });
    const labNo = `L261008${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const lo = await tx.labOrder.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        labNo,
        encounterId: p.encounterId,
        patientId: p.patientId,
        unitId: lab.id,
        priority: 'rutin',
        status: 'proses',
        idempotencyKey: newId(),
        acceptedBy: labBy.id,
      },
    });
    await tx.labOrderItem.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, labOrderId: lo.id, serviceRequestId: sr.id },
    });
    return { serviceRequestId: sr.id, labNo };
  });
}

test.describe('Mikrobiologi & Diagnostik lain mode api', () => {
  test('kultur: isolat awal → validasi teknis analis → rilis klinis dokter Lab ber-TTE', async ({
    browser,
  }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const lab = await inTenant(TENANTS.RSFA, (tx) => tx.unit.findFirstOrThrow({ where: { code: 'LAB' } }));
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Kultur ${tag}, Sp.PD`);
    const analyst = await createStaff('analis_lab', lab.id, `Analis Mikro ${tag}`);
    const spPk = await createStaff('dokter', lab.id, `dr. Patologi Klinik ${tag}, Sp.PK`);
    const p = await admitPatient(ward, dpjp, `Tn. Kultur Api ${tag}`);
    const o = await order(p, dpjp, 'Kultur darah + uji kepekaan', analyst);
    const card = (page: Page) => page.getByRole('article', { name: `Kultur ${o.labNo}` });

    const an = await as(browser, analyst, '/penunjang/mikrobiologi');
    await expect(card(an)).toContainText(p.mrn);
    const iso = card(an).getByRole('form', { name: /Tambah isolat/ });
    await iso.getByLabel('Organisme').fill('Batang Gram negatif');
    await iso.getByLabel('Pertumbuhan / pewarnaan').fill('Tumbuh 18 jam, botol aerob');
    await iso.getByRole('button', { name: 'Simpan isolat' }).click();
    await expect(status(an, 'Isolat Batang Gram negatif tercatat')).toBeVisible();
    const tech = card(an).getByRole('form', { name: /Validasi teknis/ });
    await tech.getByLabel('Kesimpulan').fill('Batang Gram negatif, identifikasi menyusul');
    await tech.getByRole('button', { name: 'Validasi teknis' }).click();
    await expect(status(an, 'Laporan awal divalidasi teknis')).toBeVisible();

    const dr = await as(browser, spPk, '/penunjang/mikrobiologi');
    await card(dr).getByRole('button', { name: 'Rilis klinis awal (TTE)' }).click();
    await expect(status(dr, 'Laporan dirilis dengan TTE')).toBeVisible();
    await expect(card(dr)).toContainText('awal: dirilis');
  });

  test('S10: order EKG → isian formulir + kesimpulan → TTE', async ({ browser }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const lab = await inTenant(TENANTS.RSFA, (tx) => tx.unit.findFirstOrThrow({ where: { code: 'LAB' } }));
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP EKG ${tag}, Sp.PD`);
    const cardio = await createStaff('dokter', lab.id, `dr. Jantung Diagnostik ${tag}, Sp.JP`);
    const p = await admitPatient(ward, dpjp, `Ny. EKG Api ${tag}`);
    await order(p, dpjp, 'EKG 12 sadapan');

    const page = await as(browser, cardio, '/penunjang/diagnostik');
    const item = page.getByRole('article', { name: 'Order EKG 12 sadapan' }).filter({ hasText: p.mrn });
    await item.getByLabel('Irama').selectOption({ label: 'Sinus' });
    await item.getByLabel('Laju jantung (x/menit)').fill('76');
    await item.getByLabel('Temuan (aksis, interval, ST-T)').fill('Aksis normal, PR 160 ms, ST-T normal');
    await item.getByLabel('Kesimpulan').fill('EKG dalam batas normal');
    await item.getByRole('button', { name: 'Simpan laporan' }).click();
    await expect(status(page, 'Laporan tersimpan')).toBeVisible();
    await item.getByRole('button', { name: 'Tandatangani laporan (TTE)' }).click();
    await expect(item).toContainText('TTE · di panel hasil');
  });
});
