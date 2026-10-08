import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BLOOD_ISSUE_CHECK_ITEMS, newId } from '@simrs/shared';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import { admitPatient, createStaff, createWard } from './support/inpatient';

/**
 * Fase 4 · 4.9 · layar Gizi (S07) dan Bank darah (S08) mode api (ADR-0105). Bank darah: DPJP meminta darah → analis
 * menerima + crossmatch + cek ganda pertama → analis KEDUA mengeluarkan dari sesinya sendiri → perawat memindai gelang
 * + kantong (gelang salah ditolak) → perawat KEDUA memverifikasi → TTV → selesai. Gizi: perawat mengorder diet → ahli
 * gizi melihat daftar makan, catat antar + sisa → cetak label. Pasien diadmisi lewat API sungguhan. Data fiktif.
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

test.describe('Gizi + Bank darah mode api', () => {
  test('bank darah: permintaan DPJP → crossmatch → cek ganda dua analis → gelang ↔ kantong + perawat kedua → selesai', async ({
    browser,
  }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Darah ${tag}, Sp.PD`);
    const nurse = await createStaff('perawat', ward.unitId, `Ns. Pemasang ${tag}`);
    const nurse2 = await createStaff('perawat', ward.unitId, `Ns. Verifikator ${tag}`);
    const analyst = await createStaff('analis_lab', null, `Analis Satu ${tag}`);
    const analyst2 = await createStaff('analis_lab', null, `Analis Dua ${tag}`);
    const p = await admitPatient(ward, dpjp, `Tn. Transfusi Api ${tag}`);
    const bagNo = `KTG-E2E-${newId().slice(-6).toUpperCase()}`;
    const unitId = await inTenant(TENANTS.RSFA, async (tx) => {
      const prc = await tx.bloodComponent.findFirstOrThrow({ where: { code: 'PRC' } });
      const u = await tx.bloodUnit.create({
        data: {
          id: newId(),
          tenantId: TENANTS.RSFA,
          bagNo,
          componentId: prc.id,
          abo: 'A',
          rh: 'pos',
          collectedAt: new Date(Date.now() - 2 * 86_400_000),
          expiresAt: new Date(Date.now() + 20 * 86_400_000),
        },
      });
      return u.id;
    });

    // 1 · DPJP meminta darah untuk kunjungan pasiennya.
    const doc = await as(browser, dpjp, `/penunjang/bank-darah?kunjungan=${p.encounterId}`);
    await expect(doc.getByLabel('Identitas pasien')).toContainText(p.mrn);
    const form = doc.getByRole('form', { name: 'Permintaan darah' });
    await form.getByLabel('Urgensi').selectOption('cito');
    await form.getByLabel('Golongan pasien bila sudah diketahui').selectOption({ label: 'A Rh+' });
    await form.getByLabel('Indikasi transfusi').fill('Anemia berat Hb 6,2 g/dL, simtomatik');
    await form.getByRole('button', { name: 'Kirim permintaan darah' }).click();
    await expect(status(doc, /Permintaan darah BD-\d{4}-\d{4} terkirim/)).toBeVisible();
    const rq = await inTenant(TENANTS.RSFA, (tx) =>
      tx.bloodRequest.findFirstOrThrow({ where: { encounterId: p.encounterId } }),
    );
    const card = (page: Page) => page.getByRole('article', { name: `Permintaan darah ${rq.requestNo}` });

    // 2 · Analis pertama: terima, crossmatch, cek ganda pertama; tidak bisa mengeluarkan sendiri.
    const lab = await as(browser, analyst, '/penunjang/bank-darah');
    await card(lab).getByRole('button', { name: 'Terima permintaan + sampel (label cocok)' }).click();
    await expect(status(lab, `Permintaan ${rq.requestNo} dan sampel diterima`)).toBeVisible();
    const xm = card(lab).getByRole('group', { name: 'Crossmatch' });
    await xm.getByLabel('Kantong untuk crossmatch').selectOption(unitId);
    await xm.getByRole('button', { name: 'Catat crossmatch' }).click();
    await expect(status(lab, 'Crossmatch cocok; kantong dicadangkan')).toBeVisible();
    const check = card(lab).getByRole('group', { name: 'Cek ganda pertama' });
    await check.getByLabel('Kantong', { exact: true }).selectOption(unitId);
    for (const item of BLOOD_ISSUE_CHECK_ITEMS)
      await check.getByRole('checkbox', { name: item.label }).check();
    await check.getByRole('button', { name: 'Simpan cek ganda pertama' }).click();
    await expect(status(lab, 'Cek ganda pertama tercatat')).toBeVisible();
    await expect(card(lab)).toContainText('Petugas kedua (bukan Anda) mengeluarkan dari sesinya sendiri.');

    // 3 · Analis kedua mengeluarkan kantong dari sesinya sendiri.
    const lab2 = await as(browser, analyst2, '/penunjang/bank-darah');
    await card(lab2)
      .getByRole('button', { name: `Keluarkan kantong ${bagNo} (petugas kedua)` })
      .click();
    // Permintaan selesai → panel pengeluaran hilang; kantong tampil sebagai sudah keluar.
    await expect(card(lab2).getByRole('region', { name: `Kantong ${bagNo}` })).toContainText('Belum dipasang');

    // 4 · Perawat pemasang: gelang salah ditolak; gelang + kantong benar → menunggu petugas kedua.
    const ns = await as(browser, nurse, '/penunjang/bank-darah');
    const bag = (page: Page) => card(page).getByRole('region', { name: `Kantong ${bagNo}` });
    const fill = async (page: Page, band: string) => {
      await bag(page).getByLabel('Pindai gelang pasien').fill(band);
      await bag(page).getByLabel('Pindai nomor kantong').fill(bagNo);
    };
    await fill(ns, 'GLSALAH0000000');
    for (const [label, v] of [
      ['Suhu (°C)', '36.7'],
      ['Sistolik', '118'],
      ['Diastolik', '76'],
      ['Nadi', '82'],
    ] as const) {
      await bag(ns).getByLabel(label).fill(v);
    }
    await bag(ns).getByRole('button', { name: 'Cocokkan gelang + kantong dan catat TTV awal' }).click();
    await expect(bag(ns).getByRole('alert')).toContainText('Gelang pasien tidak cocok');
    await fill(ns, p.wristbandCode);
    await bag(ns).getByRole('button', { name: 'Cocokkan gelang + kantong dan catat TTV awal' }).click();
    await expect(status(ns, 'Gelang dan kantong cocok')).toBeVisible();
    await expect(bag(ns)).toContainText('Menunggu verifikasi petugas kedua');
    await expect(bag(ns)).toContainText('Petugas kedua (bukan Anda) memindai ulang');

    // 5 · Perawat kedua memverifikasi dari sesinya sendiri → transfusi berjalan.
    const ns2 = await as(browser, nurse2, '/penunjang/bank-darah');
    await fill(ns2, p.wristbandCode);
    await bag(ns2).getByRole('button', { name: 'Verifikasi petugas kedua' }).click();
    await expect(status(ns2, 'Transfusi berjalan')).toBeVisible();

    // 6 · TTV 15 menit tanpa reaksi → selesai.
    await ns.reload();
    const v = bag(ns).getByRole('group', { name: `TTV transfusi ${bagNo}` });
    for (const [label, val] of [
      ['Suhu (°C)', '36.9'],
      ['Sistolik', '116'],
      ['Diastolik', '74'],
      ['Nadi', '84'],
    ] as const) {
      await v.getByLabel(label).fill(val);
    }
    await v.getByRole('button', { name: 'Catat TTV' }).click();
    await expect(status(ns, 'TTV tercatat, tanpa tanda reaksi')).toBeVisible();
    await v.getByRole('button', { name: 'Transfusi selesai' }).click();
    await expect(status(ns, 'Transfusi selesai tanpa reaksi')).toBeVisible();
    const t = await inTenant(TENANTS.RSFA, (tx) =>
      tx.transfusion.findFirstOrThrow({ where: { encounterId: p.encounterId } }),
    );
    expect(t.status).toBe('selesai');
    expect(t.startedBy).toBe(nurse.id);
    expect(t.verifiedBy).toBe(nurse2.id);
  });

  test('gizi: perawat mengorder diet → ahli gizi mencatat antar + sisa → cetak label dua pengenal', async ({
    browser,
  }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Gizi ${tag}, Sp.PD`);
    const nurse = await createStaff('perawat', ward.unitId, `Ns. Gizi ${tag}`);
    const nutritionist = await createStaff('ahli_gizi', null, `Ahli Gizi ${tag}, S.Gz`);
    const p = await admitPatient(ward, dpjp, `Ny. Diet Api ${tag}`);

    const ns = await as(browser, nurse, `/penunjang/gizi?kunjungan=${p.encounterId}`);
    const order = ns.getByRole('form', { name: 'Order diet' });
    await order.getByLabel('Jenis diet').selectOption({ label: 'Diet diabetes 1.700 kkal' });
    await order.getByLabel('Tekstur').selectOption({ label: 'Lunak' });
    await order.getByLabel('Catatan untuk dapur (pantangan, alergi makanan)').fill('Tanpa santan');
    await order.getByRole('button', { name: 'Simpan order diet' }).click();
    await expect(status(ns, 'Order diet Diet diabetes 1.700 kkal')).toBeVisible();
    await expect(ns.getByRole('region', { name: 'Order diet' })).toContainText(
      'Aktif: Diet diabetes 1.700 kkal',
    );

    // 4.9b: skrining MST oleh perawat; puasa menahan antar sampai dicabut.
    const mst = ns.getByRole('form', { name: 'Skrining gizi MST' });
    await mst
      .getByLabel('Penurunan berat badan tanpa disengaja (6 bulan)')
      .selectOption({ label: 'Turun 6–10 kg' });
    await mst.getByLabel('Asupan makan berkurang karena nafsu makan turun').check();
    await expect(mst).toContainText('Skor MST 3 · berisiko malnutrisi');
    await mst.getByRole('button', { name: 'Simpan skrining' }).click();
    await expect(status(ns, 'Skrining MST tercatat: skor 3')).toBeVisible();
    const npo = ns.getByRole('form', { name: 'Mulai puasa' });
    await npo.getByLabel('Alasan puasa').fill('Persiapan USG abdomen pukul 10.00');
    await npo.getByRole('button', { name: 'Mulai puasa' }).click();
    await expect(status(ns, 'Puasa dimulai')).toBeVisible();

    // Ahli gizi: order belum terverifikasi + puasa → tidak bisa diantar; verifikasi, lalu perawat mencabut puasa.
    const gz = await as(browser, nutritionist, `/penunjang/gizi?jam=siang&unit=${ward.unitId}`);
    const row = gz.getByRole('listitem', { name: `Makan ${p.patientName}` });
    await expect(row).toContainText(p.mrn);
    await expect(row).toContainText('Tanpa santan');
    await expect(row).toContainText('Puasa: Persiapan USG abdomen pukul 10.00');
    await expect(row.getByRole('button', { name: 'Catat diantar' })).toHaveCount(0);
    await expect(row).toContainText('MST 3 · berisiko');
    await row.getByRole('button', { name: 'Verifikasi order diet' }).click();
    await expect(status(gz, 'Order diet terverifikasi')).toBeVisible();
    await ns.reload();
    await ns.getByRole('region', { name: 'Puasa' }).getByRole('button', { name: 'Cabut puasa' }).click();
    await expect(status(ns, 'Puasa dicabut')).toBeVisible();
    await gz.goto(`/penunjang/gizi?jam=siang&unit=${ward.unitId}`);
    await row.getByRole('button', { name: 'Catat diantar' }).click();
    await expect(status(gz, 'Makanan tercatat diantar')).toBeVisible();
    await row.getByLabel(`Sisa makanan ${p.patientName}`).selectOption({ label: 'Sisa ½' });
    await row.getByRole('button', { name: 'Catat sisa' }).click();
    await expect(status(gz, 'Sisa makanan tercatat')).toBeVisible();
    await expect(row).toContainText('Sisa: Sisa ½');

    await gz.goto(`/cetak/gizi?jam=siang&unit=${ward.unitId}`);
    const label = gz.getByRole('article', { name: `Label ${p.patientName}` });
    await expect(label).toContainText(p.mrn);
    await expect(label).toContainText('Diet diabetes 1.700 kkal · Lunak');
  });
});
